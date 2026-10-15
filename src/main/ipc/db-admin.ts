import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { app, BrowserWindow, dialog, shell } from 'electron';
import type { OpenDialogOptions, SaveDialogOptions } from 'electron';
import type { ConnectionConfig } from '@shared/connection';
import type { ToolFamily } from '@shared/db-admin';
import { TOOL_FAMILIES, backupFileFilters, backupModeOf } from '@shared/db-admin';
import type { DbHostClient } from '../services/db-host-client';
import type { ConnectionStore } from '../services/connection-store';
import type { SecretStore } from '../services/secret-store';
import type { AuxTools } from '../services/aux-tools';
import type { BackupRunner } from '../services/db-backup';
import { AppError, handle } from './handle';

interface Deps {
  dbHost: DbHostClient;
  connections: ConnectionStore;
  secrets: SecretStore;
  tools: AuxTools;
  runner: BackupRunner;
}

/** Familias de herramientas que sirven a cada motor (MariaDB y MySQL comparten motor, no binarios). */
const FAMILIES_OF: Record<string, readonly ToolFamily[]> = {
  postgres: ['postgres'],
  mariadb: ['mariadb', 'mysql'],
};

/**
 * Canales `dbadmin:*` (crear, eliminar, renombrar, respaldar y restaurar bases) y `tools:*`
 * (herramientas auxiliares que aporta el usuario). El renderer nunca elige rutas de respaldo
 * libremente: solo las que salieron de un diálogo de main (specs/08).
 */
export function registerDbAdminHandlers({ dbHost, connections, secrets, tools, runner }: Deps): void {
  const connectionOf = (id: string): ConnectionConfig => {
    const config = connections.get(id);
    if (!config) throw new AppError('not-found', 'La conexión no existe');
    return config;
  };

  handle('dbadmin:create', async ({ connectionId, name }) => {
    await dbHost.request('admin.create', { connectionId, name });
    return {};
  });
  handle('dbadmin:drop', async ({ connectionId, database }) => {
    await dbHost.request('admin.drop', { connectionId, database }, { timeoutMs: null });
    return {};
  });
  handle('dbadmin:rename', async ({ connectionId, database, newName }) => {
    await dbHost.request('admin.rename', { connectionId, database, newName }, { timeoutMs: null });
    return {};
  });

  const authorized = new Set<string>();
  handle('dbadmin:pick-file', async ({ mode, engine, defaultName }, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const filters = backupFileFilters(engine);
    let path: string | undefined;
    if (mode === 'save') {
      const options: SaveDialogOptions = {
        title: 'Guardar respaldo',
        defaultPath: join(app.getPath('documents'), defaultName),
        filters,
      };
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      path = result.canceled ? undefined : result.filePath;
    } else {
      const options: OpenDialogOptions = {
        title: 'Elegir respaldo',
        defaultPath: app.getPath('documents'),
        properties: ['openFile'],
        filters: [...filters, { name: 'Todos los archivos', extensions: ['*'] }],
      };
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      path = result.canceled ? undefined : result.filePaths[0];
    }
    if (!path) return { path: null };
    authorized.add(path);
    return { path };
  });

  /** Contraseña para una herramienta externa: la guardada, o la que el usuario escribió en el diálogo. */
  const secretFor = (config: ConnectionConfig, typed: string | undefined): string | undefined =>
    typed ?? (config.savePassword ? secrets.get(config.id) : undefined);

  const toolJob = (
    kind: 'backup' | 'restore',
    req: {
      connectionId: string;
      database: string;
      path: string;
      password?: string;
      family?: ToolFamily;
      options?: { noOwner: boolean; noPrivileges: boolean };
    },
  ) => {
    const config = connectionOf(req.connectionId);
    const family = req.family;
    if (!family || !FAMILIES_OF[config.engine]?.includes(family)) {
      throw new AppError('invalid-payload', 'La herramienta no corresponde al motor de la conexión');
    }
    if (kind === 'restore' && config.readOnly) {
      throw new AppError('forbidden', 'La conexión es de solo lectura');
    }
    if (!authorized.delete(req.path)) throw new AppError('forbidden', 'Ruta de respaldo no autorizada');
    return {
      family,
      kind,
      config,
      secret: secretFor(config, req.password),
      database: req.database,
      file: req.path,
      options: kind === 'restore' ? req.options : undefined,
    };
  };

  handle('dbadmin:backup', async (req) => {
    const config = connectionOf(req.connectionId);
    if (backupModeOf(config.engine) === 'server') {
      const result = await dbHost.request(
        'admin.backup',
        { connectionId: req.connectionId, database: req.database, path: req.path },
        { timeoutMs: null },
      );
      return { path: result.path };
    }
    if (backupModeOf(config.engine) === 'none')
      throw new AppError('invalid-payload', 'El motor no admite respaldos');
    const { bytes } = await runner.run(req.operationId, toolJob('backup', req));
    return { path: req.path, bytes };
  });

  handle('dbadmin:restore', async (req) => {
    const config = connectionOf(req.connectionId);
    if (backupModeOf(config.engine) === 'server') {
      await dbHost.request(
        'admin.restore',
        { connectionId: req.connectionId, database: req.database, path: req.path },
        { timeoutMs: null },
      );
      return {};
    }
    if (backupModeOf(config.engine) === 'none')
      throw new AppError('invalid-payload', 'El motor no admite restauraciones');
    await runner.run(req.operationId, toolJob('restore', req));
    return {};
  });

  handle('dbadmin:cancel', ({ operationId }) => {
    runner.cancel(operationId);
    return {};
  });

  handle('tools:status', () => Promise.all(TOOL_FAMILIES.map((family) => tools.status(family))));
  handle('tools:import', ({ family, paths }) => tools.import(family, paths));
  handle('tools:open-folder', async () => {
    // Se crea si aún no se importó nada, para que el explorador abra siempre en el lugar correcto.
    await mkdir(tools.rootDir, { recursive: true });
    const error = await shell.openPath(tools.rootDir);
    if (error) throw new AppError('internal', error);
    return { path: tools.rootDir };
  });
  handle('tools:remove', ({ family }) => tools.remove(family));
  handle('tools:pick', async ({ family }, event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: 'Elegir herramientas auxiliares',
      defaultPath: await tools.lastSourceDir(family),
      properties: ['openFile', 'multiSelections'],
      filters: process.platform === 'win32' ? [{ name: 'Ejecutables', extensions: ['exe'] }] : [],
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    return tools.import(family, result.filePaths);
  });
}
