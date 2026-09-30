import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { devServerUrl, devToolsEnabled, rendererIndexPath } from '../security';

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    show: false,
    title: 'DB Explorer',
    backgroundColor: '#1f1f1f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: devToolsEnabled,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  if (devServerUrl) void win.loadURL(devServerUrl);
  else void win.loadFile(rendererIndexPath);

  return win;
}
