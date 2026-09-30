import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { IpcEventChannel } from '@shared/channels';
import type { IpcEventPayload } from '@shared/ipc';
import { devServerUrl, devToolsEnabled, rendererIndexPath } from '../security';

/** Colores de fondo iniciales (`bg.editor`) para evitar destellos al abrir. */
const BACKGROUND = { dark: '#1F1F1F', light: '#FFFFFF' } as const;

function send<C extends IpcEventChannel>(win: BrowserWindow, channel: C, payload: IpcEventPayload<C>): void {
  if (!win.isDestroyed()) win.webContents.send(channel, payload);
}

export function createMainWindow(options: { dark: boolean }): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    frame: false,
    title: 'DB Explorer',
    backgroundColor: options.dark ? BACKGROUND.dark : BACKGROUND.light,
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

  const notify = (): void => send(win, 'app:window-state', { maximized: win.isMaximized() });
  win.on('maximize', notify);
  win.on('unmaximize', notify);

  // Sin menú nativo no hay atajo para las DevTools: se agrega Ctrl+Shift+I cuando están habilitadas.
  if (devToolsEnabled) {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
        win.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }

  if (devServerUrl) void win.loadURL(devServerUrl);
  else void win.loadFile(rendererIndexPath);

  return win;
}
