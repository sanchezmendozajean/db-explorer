import { app, BrowserWindow, Menu, nativeTheme, safeStorage } from 'electron';
import { join } from 'node:path';
import type { IpcEventChannel } from '@shared/channels';
import type { IpcEventPayload } from '@shared/ipc';
import { applySecurityPolicies } from './security';
import { createMainWindow } from './windows/main-window';
import { applyThemeSource, registerIpcHandlers } from './ipc/register';
import { DbHostClient } from './services/db-host-client';
import { createUtilityTransport } from './services/utility-transport';
import { UiStateStore } from './services/ui-state-store';
import { ConnectionStore } from './services/connection-store';
import { SecretStore } from './services/secret-store';
import { registerConnectionHandlers } from './ipc/connections';

function broadcast<C extends IpcEventChannel>(channel: C, payload: IpcEventPayload<C>): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}

// Solo desarrollo/pruebas: aislar `userData` (las pruebas e2e no tocan los datos reales del usuario).
const userDataOverride = process.env['DBX_USER_DATA_DIR'];
if (userDataOverride && !app.isPackaged) app.setPath('userData', userDataOverride);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const dbHost = new DbHostClient(createUtilityTransport, {
    onRestart: (reason) => broadcast('app:db-host-restarted', { reason }),
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
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (plain) => safeStorage.encryptString(plain),
      decrypt: (data) => safeStorage.decryptString(data),
    });
    await secrets.load();

    dbHost.start();
    registerIpcHandlers({ dbHost, uiState });
    registerConnectionHandlers({ dbHost, connections, secrets, skippedOnLoad: skipped });

    const open = (): BrowserWindow => createMainWindow({ dark: nativeTheme.shouldUseDarkColors });
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
