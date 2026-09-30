import { BrowserWindow } from 'electron';
import { validateSetting } from '@shared/settings';
import type { WorkspaceState } from '@shared/workspace';
import type { SettingsStore } from '../services/settings-store';
import type { WorkspaceService } from '../services/workspace-service';
import { AppError, handle } from './handle';

interface Deps {
  settings: SettingsStore;
  workspace: WorkspaceService;
}

/** Canales `settings:*` y `fs:*` del espacio de trabajo y los scripts (specs/11). */
export function registerWorkspaceHandlers({ settings, workspace }: Deps): void {
  handle('settings:get', () => settings.settings);

  handle('settings:update', async ({ key, value }) => {
    if (value !== undefined && !validateSetting(key, value)) {
      throw new AppError('invalid-payload', `Valor inválido para "${key}"`);
    }
    const updated = await settings.update(key, value);
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('settings:changed', updated);
    return updated;
  });

  handle('fs:open-workspace', async () => {
    const info = await workspace.open(settings.settings['workspace.path']);
    // El renderer trabaja con rutas absolutas; en disco se guardan relativas al espacio.
    if (info.state) {
      info.state = {
        ...info.state,
        tabs: info.state.tabs.map((t) => ({ ...t, file: workspace.resolve(t.file) })),
      };
    }
    return info;
  });

  handle('fs:save-workspace-state', async (state: WorkspaceState) => {
    await workspace.saveState({
      ...state,
      tabs: state.tabs.map((t) => ({ ...t, file: workspace.toStatePath(t.file) })),
    });
    return {};
  });

  handle('fs:new-script', async () => ({ path: await workspace.newScript() }));

  handle('fs:list-files', () => workspace.listFiles());

  handle('fs:read-script', ({ path }) => workspace.readScript(path));

  handle('fs:write-script', ({ path, content, bom, expectedMtimeMs, force }) =>
    workspace.writeScript(path, content, { bom, expectedMtimeMs, force }),
  );

  handle('fs:delete-empty-script', async ({ path }) => ({ deleted: await workspace.deleteIfEmpty(path) }));
}
