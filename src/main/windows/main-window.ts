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

/** Ventanas cuyo renderer guarda los scripts antes de cerrar (specs/11 §4). */
const closeGuards = new WeakMap<BrowserWindow, { listening: boolean; allowed: boolean }>();

/** El renderer avisa que atiende el cierre (`listening`) o que ya terminó de guardar (`ready`). */
export function setClosePhase(win: BrowserWindow, phase: 'listening' | 'ready'): void {
  const guard = closeGuards.get(win);
  if (!guard) return;
  if (phase === 'listening') guard.listening = true;
  else {
    guard.allowed = true;
    win.close();
  }
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

  // Al cerrar (botón, Alt+F4 o salir) se da al renderer la oportunidad de guardar los scripts.
  const guard = { listening: false, allowed: false };
  closeGuards.set(win, guard);
  win.on('close', (event) => {
    if (guard.allowed || !guard.listening || win.webContents.isCrashed()) return;
    event.preventDefault();
    send(win, 'app:before-close', {});
  });
  // Al recargar o si el renderer se cae, deja de atender el cierre hasta que vuelva a avisar.
  win.webContents.on('did-start-navigation', (_e, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) guard.listening = false;
  });
  win.webContents.on('render-process-gone', () => {
    guard.listening = false;
  });

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
