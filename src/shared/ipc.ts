import { z } from 'zod';
import type { IpcEventChannel, IpcInvokeChannel } from './channels';
import { UiStateSchema } from './ui-state';

/**
 * Contrato IPC entre renderer y main. Cada canal de petición declara el
 * esquema de su payload (validado en main) y el de su respuesta.
 */

const Empty = z.object({}).strict();

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

export const WindowStateSchema = z.object({
  maximized: z.boolean(),
});

export const WindowControlSchema = z.object({
  action: z.enum(['minimize', 'toggle-maximize', 'close']),
});

export const ZoomRequestSchema = z.object({
  action: z.enum(['in', 'out', 'reset']),
});

export const EditRequestSchema = z.object({
  action: z.enum(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']),
});

export const ClipboardWriteSchema = z.object({
  text: z.string().max(10_000_000),
});

export const ipcInvokeContract = {
  'app:ping': { request: PingRequestSchema, response: PingResultSchema },
  'app:get-ui-state': { request: Empty, response: UiStateSchema },
  'app:set-ui-state': { request: UiStateSchema, response: Empty },
  'app:window-control': { request: WindowControlSchema, response: WindowStateSchema },
  'app:get-window-state': { request: Empty, response: WindowStateSchema },
  'app:zoom': { request: ZoomRequestSchema, response: z.object({ level: z.number() }) },
  'app:edit': { request: EditRequestSchema, response: Empty },
  'app:clipboard-write': { request: ClipboardWriteSchema, response: Empty },
} as const satisfies Record<IpcInvokeChannel, { request: z.ZodType; response: z.ZodType }>;

export const DbHostRestartedEventSchema = z.object({
  reason: z.string(),
});

export const ipcEventContract = {
  'app:db-host-restarted': DbHostRestartedEventSchema,
  'app:window-state': WindowStateSchema,
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
export type WindowState = IpcResponse<'app:get-window-state'>;
