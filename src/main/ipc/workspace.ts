import { BrowserWindow, dialog, shell } from 'electron';
import type { IpcMainInvokeEvent, OpenDialogOptions, SaveDialogOptions } from 'electron';
import { isAbsolute, join } from 'node:path';
import { validateSetting } from '@shared/settings';
import type { WorkspaceInfo, WorkspaceState } from '@shared/workspace';
import { TEXT_EXTENSIONS } from '@shared/workspace';
import type { SettingsStore } from '../services/settings-store';
import type { WorkspaceService } from '../services/workspace-service';
import { WorkspaceWatcher } from '../services/workspace-watcher';
import { ConfigWatcher } from '../services/config-watcher';
import type { KeybindingsStore } from '../services/keybindings-store';
import { ensureFile, KEYBINDINGS_TEMPLATE, SETTINGS_TEMPLATE } from '../services/keybindings-store';
import { AppError, handle } from './handle';

interface Deps {
  settings: SettingsStore;
  workspace: WorkspaceService;
  keybindings: KeybindingsStore;
  /** Carpeta de `settings.json` y `keybindings.json`. */
  userData: string;
}

function windowOf(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function broadcast(
  channel: 'settings:changed' | 'settings:keybindings-changed' | 'fs:changed',
  payload: unknown,
): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}

/** Filtros del diálogo de abrir/guardar: archivos SQL y los de texto que se abren en el editor (specs/07). */
const FILE_FILTERS = [
  { name: 'SQL', extensions: ['sql'] },
  { name: 'Texto', extensions: TEXT_EXTENSIONS.filter((e) => e !== 'sql') },
  { name: 'Todos los archivos', extensions: ['*'] },
];

/** Canales `settings:*` y `fs:*` del espacio de trabajo, los scripts y la vista Archivos (specs/07 y 11). */
export function registerWorkspaceHandlers({ settings, workspace, keybindings, userData }: Deps): void {
  const settingsFile = join(userData, 'settings.json');
  const keybindingsFile = join(userData, 'keybindings.json');
  // Editar settings.json o keybindings.json (en la app o con otro editor) se aplica sin reiniciar.
  new ConfigWatcher(userData, {
    'settings.json': () =>
      void settings.load().then((updated) => {
        workspace.setExclude(updated['files.exclude']);
        broadcast('settings:changed', updated);
      }),
    'keybindings.json': () =>
      void keybindings.load().then((kb) => broadcast('settings:keybindings-changed', kb)),
  }).start();

  handle('settings:get-keybindings', () => keybindings.keybindings);

  handle('settings:open-file', async ({ file }) => {
    const path = file === 'settings' ? settingsFile : keybindingsFile;
    await ensureFile(path, file === 'settings' ? SETTINGS_TEMPLATE : KEYBINDINGS_TEMPLATE);
    // Se edita como cualquier archivo abierto con el diálogo (está fuera del espacio de trabajo).
    workspace.allow(path);
    return { path };
  });

  const watcher = new WorkspaceWatcher(
    (paths) => broadcast('fs:changed', { paths }),
    (name) => workspace.isExcluded(name),
  );
  workspace.setExclude(settings.settings['files.exclude']);

  /** El renderer trabaja con rutas absolutas; en disco se guardan relativas al espacio. */
  const withAbsolutePaths = (info: WorkspaceInfo): WorkspaceInfo => {
    if (!info.unavailable) watcher.start(info.path);
    if (!info.state) return info;
    const fileConnections = info.state.fileConnections
      ? Object.fromEntries(
          Object.entries(info.state.fileConnections).map(([file, target]) => [
            workspace.resolve(file),
            target,
          ]),
        )
      : undefined;
    return {
      ...info,
      state: {
        ...info.state,
        tabs: info.state.tabs.map((t) => ({ ...t, file: workspace.resolve(t.file) })),
        fileConnections,
      },
    };
  };

  handle('settings:get', () => settings.settings);

  handle('settings:update', async ({ key, value }) => {
    if (value !== undefined && !validateSetting(key, value)) {
      throw new AppError('invalid-payload', `Valor inválido para "${key}"`);
    }
    const updated = await settings.update(key, value);
    if (key === 'files.exclude') workspace.setExclude(updated['files.exclude']);
    broadcast('settings:changed', updated);
    return updated;
  });

  handle('fs:open-workspace', async ({ useDefault }) =>
    withAbsolutePaths(await workspace.open(settings.settings['workspace.path'], { useDefault })),
  );

  handle('fs:switch-workspace', async ({ path }) => {
    // El predeterminado se guarda como "sin valor" para que siga a la carpeta Documentos.
    const target = path && path !== workspace.defaultPath ? path : null;
    const info = await workspace.open(target);
    if (info.unavailable) throw new AppError('not-found', `No se encuentra la carpeta ${info.path}`);
    const updated = await settings.update('workspace.path', target ?? undefined);
    broadcast('settings:changed', updated);
    return withAbsolutePaths(info);
  });

  handle('fs:recent-workspaces', async () => ({ paths: await workspace.recent() }));

  handle('fs:pick-folder', async ({ title }, event) => {
    const options: OpenDialogOptions = {
      title,
      defaultPath: workspace.root || undefined,
      properties: ['openDirectory', 'createDirectory'],
    };
    const win = windowOf(event);
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) };
  });

  handle('fs:save-workspace-state', async (state: WorkspaceState) => {
    await workspace.saveState({
      ...state,
      tabs: state.tabs.map((t) => ({ ...t, file: workspace.toStatePath(t.file) })),
      fileConnections: state.fileConnections
        ? Object.fromEntries(
            Object.entries(state.fileConnections)
              .filter(([file]) => isAbsolute(file))
              .map(([file, target]) => [workspace.toStatePath(file), target]),
          )
        : undefined,
    });
    return {};
  });

  handle('fs:new-script', async () => ({ path: await workspace.newScript() }));

  handle('fs:list-files', () => workspace.listFiles());

  handle('fs:list-dir', ({ path }) => workspace.listDir(path));

  handle('fs:create', async ({ dir, name, kind }) => ({ path: await workspace.create(dir, name, kind) }));

  handle('fs:rename', async ({ path, name }) => ({ path: await workspace.rename(path, name) }));

  handle('fs:move', async ({ paths, targetDir }) => ({ moved: await workspace.move(paths, targetDir) }));

  handle('fs:copy', async ({ paths, targetDir }) => ({ created: await workspace.copy(paths, targetDir) }));

  handle('fs:trash', async ({ paths }) => {
    await workspace.trash(paths);
    return {};
  });

  handle('fs:reveal', async ({ path }) => {
    shell.showItemInFolder(await workspace.inside(path));
    return {};
  });

  handle('fs:open-external', async ({ path }) => {
    const error = await shell.openPath(await workspace.inside(path));
    if (error) throw new AppError('internal', error);
    return {};
  });

  handle('fs:open-file-dialog', async ({ title }, event) => {
    const options: OpenDialogOptions = {
      title,
      defaultPath: workspace.root || undefined,
      properties: ['openFile'],
      filters: FILE_FILTERS,
    };
    const win = windowOf(event);
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const path = result.canceled ? null : (result.filePaths[0] ?? null);
    // Un archivo elegido por el usuario se puede leer y guardar aunque esté fuera del espacio.
    if (path) workspace.allow(path);
    return { path };
  });

  handle('fs:save-as', async ({ defaultPath, content, bom }, event) => {
    const options: SaveDialogOptions = {
      defaultPath: isAbsolute(defaultPath) ? defaultPath : join(workspace.root, defaultPath),
      filters: FILE_FILTERS,
    };
    const win = windowOf(event);
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { path: null, mtimeMs: 0 };
    workspace.allow(result.filePath);
    const { mtimeMs } = await workspace.writeScript(result.filePath, content, { bom, force: true });
    return { path: result.filePath, mtimeMs };
  });

  handle('fs:read-script', ({ path }) => workspace.readScript(path));

  handle('fs:write-script', ({ path, content, bom, expectedMtimeMs, force }) =>
    workspace.writeScript(path, content, { bom, expectedMtimeMs, force }),
  );

  handle('fs:delete-empty-script', async ({ path }) => ({ deleted: await workspace.deleteIfEmpty(path) }));
}
