import { BrowserWindow, clipboard, ipcMain, nativeTheme } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { IpcInvokeChannel } from '@shared/channels';
import type { IpcError, IpcRequest, IpcResponse, IpcResult } from '@shared/ipc';
import { ipcInvokeContract } from '@shared/ipc';
import type { DbHostClient } from '../services/db-host-client';
import { DbHostTimeoutError, DbHostUnavailableError } from '../services/db-host-client';
import type { UiStateStore } from '../services/ui-state-store';
import { isTrustedRendererUrl } from '../security';

type Handler<C extends IpcInvokeChannel> = (
  request: IpcRequest<C>,
  event: IpcMainInvokeEvent,
) => Promise<IpcResponse<C>> | IpcResponse<C>;

function toIpcError(err: unknown): IpcError {
  if (err instanceof DbHostUnavailableError) return { code: 'db-host-unavailable', message: err.message };
  if (err instanceof DbHostTimeoutError) return { code: 'timeout', message: err.message };
  return { code: 'internal', message: err instanceof Error ? err.message : 'Error interno' };
}

/**
 * Registra un canal de petición: verifica el origen, valida el payload con
 * zod y envuelve la respuesta en `IpcResult`.
 */
function handle<C extends IpcInvokeChannel>(channel: C, handler: Handler<C>): void {
  const schema = ipcInvokeContract[channel].request;
  ipcMain.handle(
    channel,
    async (event: IpcMainInvokeEvent, raw: unknown): Promise<IpcResult<IpcResponse<C>>> => {
      const senderUrl = event.senderFrame?.url ?? '';
      if (!isTrustedRendererUrl(senderUrl)) {
        return { ok: false, error: { code: 'forbidden', message: 'Origen no autorizado' } };
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        return { ok: false, error: { code: 'invalid-payload', message: parsed.error.message } };
      }
      try {
        return { ok: true, data: await handler(parsed.data as IpcRequest<C>, event) };
      } catch (err) {
        return { ok: false, error: toIpcError(err) };
      }
    },
  );
}

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
