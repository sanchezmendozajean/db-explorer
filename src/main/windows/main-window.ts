import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { IpcEventChannel } from '@shared/channels';
import type { IpcEventPayload } from '@shared/ipc';
import icon from '../../../resources/icon.png?asset';
import { devServerUrl, devToolsEnabled, rendererIndexPath } from '../security';
import type { WindowStateStore } from '../services/window-state-store';
import type { WindowState } from './window-bounds';
import { MIN_WINDOW_SIZE, resolveWindowBounds } from './window-bounds';

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

export function createMainWindow(options: {
  dark: boolean;
  /** Última ventana guardada (sin valor: tamaño por defecto, centrada). */
  saved: WindowState | null;
  store: WindowStateStore;
}): BrowserWindow {
  const { bounds, maximized } = resolveWindowBounds(
    options.saved,
    screen.getAllDisplays().map((d) => d.workArea),
  );
  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    show: false,
    frame: false,
    title: 'DB Explorer',
    icon,
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

  if (maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  // Se guardan las dimensiones normales (no las de maximizada) para que al desmaximizar vuelvan a su sitio.
  const snapshot = (): WindowState => ({ ...win.getNormalBounds(), maximized: win.isMaximized() });
  let timer: NodeJS.Timeout | undefined;
  const scheduleSave = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => void options.store.save(snapshot()).catch(() => undefined), 500);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('maximize', scheduleSave);
  win.on('unmaximize', scheduleSave);
  win.on('close', () => {
    clearTimeout(timer);
    try {
      options.store.saveSync(snapshot());
    } catch {
      // Sin poder escribir, la próxima vez se abrirá con el tamaño por defecto.
    }
  });

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
