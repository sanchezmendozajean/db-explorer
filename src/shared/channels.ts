/**
 * Nombres de canales IPC. Este módulo no depende de zod para que el preload
 * (que corre en sandbox) pueda importarlo sin arrastrar dependencias.
 */
export const IPC_INVOKE_CHANNELS = [
  'app:ping',
  'app:get-ui-state',
  'app:set-ui-state',
  'app:window-control',
  'app:get-window-state',
  'app:zoom',
  'app:edit',
  'app:clipboard-write',
  'app:open-file-dialog',
  'app:close-ready',
  'settings:get',
  'settings:update',
  'workspace:open',
  'workspace:save-state',
  'workspace:new-script',
  'fs:read-script',
  'fs:write-script',
  'fs:delete-empty-script',
  'conn:list',
  'conn:save',
  'conn:delete',
  'conn:set-layout',
  'conn:test',
  'conn:connect',
  'conn:disconnect',
  'meta:children',
  'meta:count',
  'query:execute',
  'query:fetch-more',
  'query:cancel',
  'query:close-session',
] as const;

export const IPC_EVENT_CHANNELS = [
  'app:db-host-restarted',
  'app:window-state',
  'app:before-close',
  'settings:changed',
  'query:event',
] as const;

export type IpcInvokeChannel = (typeof IPC_INVOKE_CHANNELS)[number];
export type IpcEventChannel = (typeof IPC_EVENT_CHANNELS)[number];
