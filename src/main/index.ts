import { app, BrowserWindow } from 'electron';
import type { IpcEventChannel } from '@shared/channels';
import type { IpcEventPayload } from '@shared/ipc';
import { applySecurityPolicies } from './security';
import { createMainWindow } from './windows/main-window';
import { registerIpcHandlers } from './ipc/register';
import { DbHostClient } from './services/db-host-client';
import { createUtilityTransport } from './services/utility-transport';

function broadcast<C extends IpcEventChannel>(channel: C, payload: IpcEventPayload<C>): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}

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

  void app.whenReady().then(() => {
    applySecurityPolicies();
    dbHost.start();
    registerIpcHandlers(dbHost);
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => dbHost.dispose());
}
