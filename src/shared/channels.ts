/**
 * Nombres de canales IPC. Este módulo no depende de zod para que el preload
 * (que corre en sandbox) pueda importarlo sin arrastrar dependencias.
 */
export const IPC_INVOKE_CHANNELS = ['app:ping'] as const;
export const IPC_EVENT_CHANNELS = ['app:db-host-restarted'] as const;

export type IpcInvokeChannel = (typeof IPC_INVOKE_CHANNELS)[number];
export type IpcEventChannel = (typeof IPC_EVENT_CHANNELS)[number];
