import { app, BrowserWindow, Menu, nativeTheme, safeStorage, shell } from 'electron';
import { mkdir, rename } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { IpcEventChannel } from '@shared/channels';
import type { IpcEventPayload } from '@shared/ipc';
import { applySecurityPolicies } from './security';
import { createMainWindow } from './windows/main-window';
import { applyThemeSource, registerIpcHandlers } from './ipc/register';
import { DbHostClient } from './services/db-host-client';
import { createUtilityTransport } from './services/utility-transport';
import { UiStateStore } from './services/ui-state-store';
import { WindowStateStore } from './services/window-state-store';
import { ConnectionStore } from './services/connection-store';
import { SecretStore } from './services/secret-store';
import { registerConnectionHandlers } from './ipc/connections';
import { registerWorkspaceHandlers } from './ipc/workspace';
import { registerDbAdminHandlers } from './ipc/db-admin';
import { AuxTools } from './services/aux-tools';
import { BackupRunner } from './services/db-backup';
import { SettingsStore } from './services/settings-store';
import { WorkspaceService } from './services/workspace-service';
import { HistoryService } from './services/history-service';
import { KeybindingsStore } from './services/keybindings-store';
import { UpdateService } from './services/update-service';
import { registerUpdateHandlers } from './ipc/updates';

function broadcast<C extends IpcEventChannel>(channel: C, payload: IpcEventPayload<C>): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}

// Pruebas: aislar `userData` (las e2e no tocan los datos reales del usuario), también en el build
// empaquetado. No agrega riesgo: quien puede fijar el entorno del proceso ya puede ejecutar código.
const userDataOverride = process.env['DBX_USER_DATA_DIR'];
if (userDataOverride) {
  app.setPath('userData', userDataOverride);
  // El espacio de trabajo por defecto (DocumentosDB Explorer) también queda aislado.
  app.setPath('documents', join(userDataOverride, 'Documents'));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Se crea al estar lista la app (necesita userData); los eventos anteriores no tienen nada que registrar.
  let history: HistoryService | null = null;
  const dbHost = new DbHostClient(createUtilityTransport, {
    onRestart: (reason) => broadcast('app:db-host-restarted', { reason }),
    onQueryEvent: (event) => {
      broadcast('query:event', event);
      history?.onEvent(event);
    },
  });

  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(async () => {
    // El menú se dibuja en la title bar propia; sin menú nativo tampoco hay atajos nativos (recargar, etc.).
    Menu.setApplicationMenu(null);
    applySecurityPolicies();

    const userData = app.getPath('userData');
    const uiState = new UiStateStore(join(userData, 'ui-state.json'));
    const state = await uiState.load();
    applyThemeSource(state.theme);

    const connections = new ConnectionStore(join(userData, 'connections.json'));
    const { skipped } = await connections.load();
    const secrets = new SecretStore(join(userData, 'secrets.bin'), {
      // En Linux sin llavero (kwallet/gnome-libsecret) Electron cae en `basic_text`, que cifra con una
      // clave fija: equivale a texto plano (specs/08), así que se trata como no disponible.
      isAvailable: () =>
        safeStorage.isEncryptionAvailable() &&
        !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'),
      encrypt: (plain) => safeStorage.encryptString(plain),
      decrypt: (data) => safeStorage.decryptString(data),
    });
    await secrets.load();

    const settings = new SettingsStore(join(userData, 'settings.json'));
    await settings.load();
    // En pruebas (perfil aislado) la papelera es una carpeta del perfil: no se toca la Papelera de Windows.
    const trashItem =
      userDataOverride && !app.isPackaged
        ? async (path: string): Promise<void> => {
            const bin = join(userDataOverride, 'Papelera');
            await mkdir(bin, { recursive: true });
            await rename(path, join(bin, `${Date.now()}-${basename(path)}`));
          }
        : (path: string): Promise<void> => shell.trashItem(path);
    const workspace = new WorkspaceService(
      userData,
      join(app.getPath('documents'), 'DB Explorer'),
      trashItem,
    );

    const historyService = new HistoryService(join(userData, 'history.sqlite'), {
      enabled: () => settings.settings['history.enabled'],
      maxEntries: () => settings.settings['history.maxEntries'],
      connection: (id) => {
        const c = connections.get(id);
        return c ? { name: c.name, engine: c.engine } : undefined;
      },
    });
    history = historyService;
    app.on('will-quit', () => historyService.close());

    dbHost.start();
    registerIpcHandlers({ dbHost, uiState });
    registerConnectionHandlers({
      dbHost,
      connections,
      secrets,
      history: historyService,
      skippedOnLoad: skipped,
    });
    const auxTools = new AuxTools(join(userData, 'tools'));
    registerDbAdminHandlers({
      dbHost,
      connections,
      secrets,
      tools: auxTools,
      runner: new BackupRunner(auxTools),
    });
    const keybindings = new KeybindingsStore(join(userData, 'keybindings.json'));
    await keybindings.load();
    registerWorkspaceHandlers({ settings, workspace, keybindings, userData });

    // Sin instalador (desarrollo, pruebas con perfil aislado, versión portable) no hay nada que actualizar.
    // DBX_UPDATE_FAKE (solo sin empaquetar): ready | none | error, para probar la interfaz sin red.
    const fakeEnv = app.isPackaged ? undefined : process.env['DBX_UPDATE_FAKE'];
    const fake = fakeEnv === 'ready' || fakeEnv === 'none' || fakeEnv === 'error' ? fakeEnv : undefined;
    const updates = new UpdateService({
      fake,
      supported: app.isPackaged && !userDataOverride && !process.env['PORTABLE_EXECUTABLE_DIR'],
      onStatus: (status) => broadcast('updates:status', status),
    });
    registerUpdateHandlers(updates);
    if (settings.settings['updates.auto']) {
      // Con un respiro para no competir con el arranque; los errores de red quedan en el estado.
      setTimeout(() => void updates.check(), 5000);
    }

    const windowStore = new WindowStateStore(join(userData, 'window-state.json'));
    const savedWindow = await windowStore.load();
    const open = (): BrowserWindow =>
      createMainWindow({ dark: nativeTheme.shouldUseDarkColors, saved: savedWindow, store: windowStore });
    open();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) open();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => dbHost.dispose());
}
