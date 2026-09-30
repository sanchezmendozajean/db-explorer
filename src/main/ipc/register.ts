import { BrowserWindow, clipboard, nativeTheme } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { DbHostClient } from '../services/db-host-client';
import type { UiStateStore } from '../services/ui-state-store';
import { handle } from './handle';

function windowOf(event: IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw new Error('Ventana no encontrada');
  return win;
}

/** Límites de zoom equivalentes a los de VS Code (niveles de Chromium). */
const ZOOM_MIN = -5;
const ZOOM_MAX = 9;

export function applyThemeSource(theme: 'dark' | 'light' | 'system'): void {
  nativeTheme.themeSource = theme;
}

export function registerIpcHandlers(deps: { dbHost: DbHostClient; uiState: UiStateStore }): void {
  const { dbHost, uiState } = deps;

  handle('app:ping', async ({ message }) => {
    const start = performance.now();
    const pong = await dbHost.request('ping', { message });
    return {
      echo: pong.echo,
      dbHostPid: pong.pid,
      dbHostUptimeMs: pong.uptimeMs,
      roundTripMs: Math.round((performance.now() - start) * 100) / 100,
      versions: pong.versions,
    };
  });

  handle('app:get-ui-state', () => uiState.state);

  handle('app:set-ui-state', async (state) => {
    if (state.theme !== uiState.state.theme) applyThemeSource(state.theme);
    await uiState.save(state);
    return {};
  });

  handle('app:get-window-state', (_req, event) => ({ maximized: windowOf(event).isMaximized() }));

  handle('app:window-control', ({ action }, event) => {
    const win = windowOf(event);
    if (action === 'minimize') win.minimize();
    else if (action === 'close') win.close();
    else if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return { maximized: win.isMaximized() };
  });

  handle('app:zoom', ({ action }, event) => {
    const contents = event.sender;
    const current = contents.getZoomLevel();
    const next =
      action === 'reset' ? 0 : Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + (action === 'in' ? 1 : -1)));
    contents.setZoomLevel(next);
    return { level: next };
  });

  handle('app:edit', ({ action }, event) => {
    event.sender[action]();
    return {};
  });

  handle('app:clipboard-write', ({ text }) => {
    clipboard.writeText(text);
    return {};
  });
}
