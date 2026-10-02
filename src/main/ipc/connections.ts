import { join } from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import type { OpenDialogOptions, SaveDialogOptions } from 'electron';
import type { ExportFormat } from '@shared/query';
import type { ConnectionConfig } from '@shared/connection';
import { CompleteConnectionSchema } from '@shared/connection';
import type { DbHostClient } from '../services/db-host-client';
import type { ConnectionStore } from '../services/connection-store';
import type { SecretStore } from '../services/secret-store';
import type { HistoryService } from '../services/history-service';
import { AppError, handle } from './handle';

interface Deps {
  dbHost: DbHostClient;
  /** Entradas inválidas omitidas al cargar connections.json (se informan una vez). */
  skippedOnLoad: number;
  connections: ConnectionStore;
  secrets: SecretStore;
  history: HistoryService;
}

const EXPORT_FILTERS: Record<ExportFormat, { name: string; extensions: string[] }> = {
  csv: { name: 'CSV', extensions: ['csv'] },
  json: { name: 'JSON', extensions: ['json'] },
  xlsx: { name: 'Excel', extensions: ['xlsx'] },
  sql: { name: 'SQL', extensions: ['sql'] },
};

function requireComplete(config: ConnectionConfig): ConnectionConfig {
  const result = CompleteConnectionSchema.safeParse(config);
  if (!result.success) throw new AppError('invalid-payload', 'La conexión está incompleta');
  return result.data;
}

/**
 * Canales `conn:*` y `meta:*`. Las contraseñas guardadas se descifran aquí y
 * van directo al db-host: nunca vuelven al renderer (specs/08).
 */
export function registerConnectionHandlers({
  dbHost,
  connections,
  secrets,
  history,
  skippedOnLoad,
}: Deps): void {
  let skipped = skippedOnLoad;
  handle('conn:list', () => {
    const result = {
      ...connections.current,
      savedPasswordIds: secrets.ids(),
      encryptionAvailable: secrets.available,
      skipped,
    };
    skipped = 0;
    return result;
  });

  handle('conn:save', async ({ config, password, copyPasswordFrom }) => {
    const saved = requireComplete(config);
    const isEdit = connections.get(saved.id) !== undefined;
    await connections.upsert(saved);

    if (!saved.savePassword || password === null) {
      await secrets.delete(saved.id);
    } else if (typeof password === 'string' && secrets.available) {
      await secrets.set(saved.id, password);
    } else if (copyPasswordFrom && secrets.has(copyPasswordFrom)) {
      await secrets.copy(copyPasswordFrom, saved.id);
    }

    // Una conexión editada se cierra para que el siguiente uso tome la nueva configuración.
    if (isEdit) await dbHost.request('conn.close', { id: saved.id });
    return { config: saved };
  });

  handle('conn:delete', async ({ id }) => {
    await dbHost.request('conn.close', { id }).catch(() => undefined);
    await secrets.delete(id);
    await connections.remove(id);
    return {};
  });

  handle('conn:set-layout', async ({ folders, order }) => {
    await connections.setLayout(folders, order);
    return {};
  });

  handle('conn:test', async ({ config, password, useSavedPasswordOf }) => {
    const target = requireComplete(config);
    const secret = password ?? (useSavedPasswordOf ? secrets.get(useSavedPasswordOf) : undefined);
    return dbHost.request('conn.test', { config: target, secret });
  });

  handle('conn:connect', async ({ id, password }) => {
    const config = connections.get(id);
    if (!config) throw new AppError('not-found', 'La conexión no existe');
    let secret = password;
    if (secret === undefined && config.engine !== 'sqlite') {
      secret = config.savePassword ? secrets.get(id) : undefined;
      if (secret === undefined) throw new AppError('password-required', 'Se necesita la contraseña');
    }
    return dbHost.request('conn.open', { config, secret });
  });

  handle('conn:disconnect', async ({ id }) => {
    await dbHost.request('conn.close', { id });
    return {};
  });

  handle('meta:children', ({ connectionId, ref }) => dbHost.request('meta.children', { connectionId, ref }));

  handle('meta:count', async (req) => ({
    count: await dbHost.request('meta.count', req, { timeoutMs: null }),
  }));

  // Ejecución: sin límite de tiempo (el usuario la controla con Cancelar); las filas llegan por `query:event`.
  handle('query:execute', (req) => {
    if (req.history !== false) history.begin(req);
    return dbHost.request('query.execute', req, { timeoutMs: null });
  });
  handle('query:history-list', (query) => history.list(query));
  handle('query:history-delete', ({ id }) => {
    history.remove(id);
    return {};
  });
  handle('query:history-clear', () => {
    history.clear();
    return {};
  });
  handle('query:fetch-more', (req) => dbHost.request('query.fetchMore', req, { timeoutMs: null }));
  handle('query:cancel', async ({ queryId }) => {
    await dbHost.request('query.cancel', { queryId });
    return {};
  });
  handle('query:close-session', async ({ sessionId }) => {
    await dbHost.request('session.close', { sessionId });
    return {};
  });

  handle('query:end-transaction', async (req) => {
    await dbHost.request('session.end-transaction', req);
    return {};
  });

  handle('meta:table', (req) => dbHost.request('meta.table', req));
  handle('meta:ddl', async (req) => ({ ddl: await dbHost.request('meta.ddl', req) }));
  handle('data:apply', (req) => dbHost.request('data.apply', req, { timeoutMs: null }));

  // El renderer no elige rutas libremente: solo exporta a una ruta elegida en el diálogo de main.
  const exportPaths = new Set<string>();
  handle('data:pick-export-path', async ({ format, defaultName }, event) => {
    const filter = EXPORT_FILTERS[format];
    const options: SaveDialogOptions = {
      title: 'Exportar',
      defaultPath: join(app.getPath('documents'), `${defaultName}.${filter.extensions[0]}`),
      filters: [filter],
    };
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { path: null };
    exportPaths.add(result.filePath);
    return { path: result.filePath };
  });
  handle('data:export', async (req) => {
    if (!exportPaths.delete(req.path)) throw new AppError('forbidden', 'Ruta de exportación no autorizada');
    return dbHost.request('export.start', req, { timeoutMs: null });
  });

  handle('app:open-file-dialog', async ({ title, defaultPath, allowCreate, filters }, event) => {
    const options: OpenDialogOptions = {
      title,
      defaultPath,
      properties: allowCreate ? ['openFile', 'promptToCreate'] : ['openFile'],
      filters,
    };
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) };
  });
}
