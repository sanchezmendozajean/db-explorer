import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { IpcInvokeChannel } from '@shared/channels';
import type { IpcError, IpcRequest, IpcResponse, IpcResult } from '@shared/ipc';
import { ipcInvokeContract } from '@shared/ipc';
import type { DbHostClient } from '../services/db-host-client';
import { DbHostTimeoutError, DbHostUnavailableError } from '../services/db-host-client';
import { isTrustedRendererUrl } from '../security';

type Handler<C extends IpcInvokeChannel> = (request: IpcRequest<C>) => Promise<IpcResponse<C>>;

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
        return { ok: true, data: await handler(parsed.data as IpcRequest<C>) };
      } catch (err) {
        return { ok: false, error: toIpcError(err) };
      }
    },
  );
}

export function registerIpcHandlers(dbHost: DbHostClient): void {
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
}
