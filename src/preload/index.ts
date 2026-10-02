/**
 * Preload (sandbox): expone una API mínima y tipada como `window.api`.
 * Nunca se expone `ipcRenderer` completo.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { DbExplorerApi } from '@shared/api';
import { IPC_EVENT_CHANNELS } from '@shared/channels';
import type { IpcEventChannel, IpcInvokeChannel } from '@shared/channels';
import type { IpcEventPayload } from '@shared/ipc';

const allowedEvents: readonly string[] = IPC_EVENT_CHANNELS;

/** El tipo real de cada respuesta lo fija `DbExplorerApi`; main valida y envuelve en `IpcResult`. */
const invoke =
  (channel: IpcInvokeChannel) =>
  (request: unknown): Promise<never> =>
    ipcRenderer.invoke(channel, request) as Promise<never>;

const api: DbExplorerApi = {
  app: {
    ping: invoke('app:ping'),
    getUiState: invoke('app:get-ui-state'),
    setUiState: invoke('app:set-ui-state'),
    windowControl: invoke('app:window-control'),
    getWindowState: invoke('app:get-window-state'),
    zoom: invoke('app:zoom'),
    edit: invoke('app:edit'),
    clipboardWrite: invoke('app:clipboard-write'),
    clipboardRead: invoke('app:clipboard-read'),
    openFileDialog: invoke('app:open-file-dialog'),
    closeReady: invoke('app:close-ready'),
  },
  settings: {
    get: invoke('settings:get'),
    update: invoke('settings:update'),
    getKeybindings: invoke('settings:get-keybindings'),
    openFile: invoke('settings:open-file'),
  },
  workspace: {
    open: invoke('fs:open-workspace'),
    saveState: invoke('fs:save-workspace-state'),
    newScript: invoke('fs:new-script'),
    listFiles: invoke('fs:list-files'),
    switch: invoke('fs:switch-workspace'),
    recent: invoke('fs:recent-workspaces'),
    pickFolder: invoke('fs:pick-folder'),
  },
  fs: {
    readScript: invoke('fs:read-script'),
    writeScript: invoke('fs:write-script'),
    deleteEmptyScript: invoke('fs:delete-empty-script'),
    listDir: invoke('fs:list-dir'),
    create: invoke('fs:create'),
    rename: invoke('fs:rename'),
    move: invoke('fs:move'),
    copy: invoke('fs:copy'),
    trash: invoke('fs:trash'),
    reveal: invoke('fs:reveal'),
    openExternal: invoke('fs:open-external'),
    openFileDialog: invoke('fs:open-file-dialog'),
    saveAs: invoke('fs:save-as'),
  },
  conn: {
    list: invoke('conn:list'),
    save: invoke('conn:save'),
    delete: invoke('conn:delete'),
    setLayout: invoke('conn:set-layout'),
    test: invoke('conn:test'),
    connect: invoke('conn:connect'),
    disconnect: invoke('conn:disconnect'),
  },
  meta: {
    children: invoke('meta:children'),
    count: invoke('meta:count'),
    table: invoke('meta:table'),
    ddl: invoke('meta:ddl'),
  },
  query: {
    execute: invoke('query:execute'),
    fetchMore: invoke('query:fetch-more'),
    cancel: invoke('query:cancel'),
    closeSession: invoke('query:close-session'),
    endTransaction: invoke('query:end-transaction'),
    historyList: invoke('query:history-list'),
    historyDelete: invoke('query:history-delete'),
    historyClear: invoke('query:history-clear'),
  },
  data: {
    apply: invoke('data:apply'),
    pickExportPath: invoke('data:pick-export-path'),
    export: invoke('data:export'),
  },
  on<C extends IpcEventChannel>(channel: C, listener: (payload: IpcEventPayload<C>) => void) {
    if (!allowedEvents.includes(channel)) throw new Error(`Canal no permitido: ${String(channel)}`);
    const wrapped = (_event: IpcRendererEvent, payload: IpcEventPayload<C>): void => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);
