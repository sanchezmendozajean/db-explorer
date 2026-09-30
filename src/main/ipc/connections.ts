import { BrowserWindow, dialog } from 'electron';
import type { OpenDialogOptions } from 'electron';
import type { ConnectionConfig } from '@shared/connection';
import { CompleteConnectionSchema } from '@shared/connection';
import type { DbHostClient } from '../services/db-host-client';
import type { ConnectionStore } from '../services/connection-store';
import type { SecretStore } from '../services/secret-store';
import { AppError, handle } from './handle';

interface Deps {
  dbHost: DbHostClient;
  /** Entradas inválidas omitidas al cargar connections.json (se informan una vez). */
  skippedOnLoad: number;
  connections: ConnectionStore;
  secrets: SecretStore;
}

function requireComplete(config: ConnectionConfig): ConnectionConfig {
  const result = CompleteConnectionSchema.safeParse(config);
  if (!result.success) throw new AppError('invalid-payload', 'La conexión está incompleta');
  return result.data;
}

/**
 * Canales `conn:*` y `meta:*`. Las contraseñas guardadas se descifran aquí y
 * van directo al db-host: nunca vuelven al renderer (specs/08).
 */
export function registerConnectionHandlers({ dbHost, connections, secrets, skippedOnLoad }: Deps): void {
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
