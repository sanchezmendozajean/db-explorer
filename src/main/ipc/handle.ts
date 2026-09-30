import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import type { IpcInvokeChannel } from '@shared/channels';
import type { IpcError, IpcErrorCode, IpcRequest, IpcResponse, IpcResult } from '@shared/ipc';
import { ipcInvokeContract } from '@shared/ipc';
import { DbHostRequestError, DbHostTimeoutError, DbHostUnavailableError } from '../services/db-host-client';
import { FileAccessError, FileConflictError } from '../services/workspace-service';
import { isTrustedRendererUrl } from '../security';

export type Handler<C extends IpcInvokeChannel> = (
  request: IpcRequest<C>,
  event: IpcMainInvokeEvent,
) => Promise<IpcResponse<C>> | IpcResponse<C>;

/** Error con código IPC explícito (p. ej. `password-required`). */
export class AppError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function toIpcError(err: unknown): IpcError {
  if (err instanceof AppError) return { code: err.code, message: err.message };
  if (err instanceof DbHostUnavailableError) return { code: 'db-host-unavailable', message: err.message };
  if (err instanceof DbHostTimeoutError) return { code: 'timeout', message: err.message };
  if (err instanceof DbHostRequestError) {
    const passthrough: readonly string[] = ['engine-unavailable', 'not-connected', 'busy'];
    const code = err.code && passthrough.includes(err.code) ? (err.code as IpcErrorCode) : 'db-error';
    return { code, message: err.message };
  }
  if (err instanceof FileConflictError) return { code: 'conflict', message: err.message };
  if (err instanceof FileAccessError) return { code: 'forbidden', message: err.message };
  const errno = (err as NodeJS.ErrnoException | null)?.code;
  if (errno === 'ENOENT') return { code: 'not-found', message: 'El archivo no existe' };
  return { code: 'internal', message: err instanceof Error ? err.message : 'Error interno' };
}

/**
 * Registra un canal de petición: verifica el origen, valida el payload con
 * zod y envuelve la respuesta en `IpcResult`.
 */
export function handle<C extends IpcInvokeChannel>(channel: C, handler: Handler<C>): void {
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
