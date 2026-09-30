import { z } from 'zod';
import type { IpcEventChannel, IpcInvokeChannel } from './channels';

/**
 * Contrato IPC entre renderer y main. Cada canal de petición declara el
 * esquema de su payload (validado en main) y el de su respuesta.
 */

export const PingRequestSchema = z.object({
  message: z.string().max(200),
});

export const PingResultSchema = z.object({
  /** Mensaje devuelto por el db-host (eco del enviado). */
  echo: z.string(),
  dbHostPid: z.number().int(),
  dbHostUptimeMs: z.number().nonnegative(),
  /** Tiempo de ida y vuelta main → db-host → main, en milisegundos. */
  roundTripMs: z.number().nonnegative(),
  versions: z.object({
    node: z.string(),
    electron: z.string(),
  }),
});

export const ipcInvokeContract = {
  'app:ping': { request: PingRequestSchema, response: PingResultSchema },
} as const satisfies Record<IpcInvokeChannel, { request: z.ZodType; response: z.ZodType }>;

export const DbHostRestartedEventSchema = z.object({
  reason: z.string(),
});

export const ipcEventContract = {
  'app:db-host-restarted': DbHostRestartedEventSchema,
} as const satisfies Record<IpcEventChannel, z.ZodType>;

export type IpcRequest<C extends IpcInvokeChannel> = z.infer<(typeof ipcInvokeContract)[C]['request']>;
export type IpcResponse<C extends IpcInvokeChannel> = z.infer<(typeof ipcInvokeContract)[C]['response']>;
export type IpcEventPayload<C extends IpcEventChannel> = z.infer<(typeof ipcEventContract)[C]>;

export type IpcErrorCode = 'invalid-payload' | 'forbidden' | 'db-host-unavailable' | 'timeout' | 'internal';

export interface IpcError {
  code: IpcErrorCode;
  message: string;
}

/** Toda respuesta IPC viaja envuelta: nunca se lanzan excepciones a través del puente. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError };

export type PingRequest = IpcRequest<'app:ping'>;
export type PingResult = IpcResponse<'app:ping'>;
