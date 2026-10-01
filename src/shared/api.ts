import type { IpcEventChannel, IpcInvokeChannel } from './channels';
import type { IpcEventPayload, IpcRequest, IpcResponse, IpcResult } from './ipc';

type Invoke<C extends IpcInvokeChannel> = (request: IpcRequest<C>) => Promise<IpcResult<IpcResponse<C>>>;

/** API mínima que el preload expone al renderer como `window.api`. */
export interface DbExplorerApi {
  app: {
    ping: Invoke<'app:ping'>;
    getUiState: Invoke<'app:get-ui-state'>;
    setUiState: Invoke<'app:set-ui-state'>;
    windowControl: Invoke<'app:window-control'>;
    getWindowState: Invoke<'app:get-window-state'>;
    zoom: Invoke<'app:zoom'>;
    edit: Invoke<'app:edit'>;
    clipboardWrite: Invoke<'app:clipboard-write'>;
    openFileDialog: Invoke<'app:open-file-dialog'>;
    closeReady: Invoke<'app:close-ready'>;
  };
  settings: {
    get: Invoke<'settings:get'>;
    update: Invoke<'settings:update'>;
  };
  workspace: {
    open: Invoke<'fs:open-workspace'>;
    saveState: Invoke<'fs:save-workspace-state'>;
    newScript: Invoke<'fs:new-script'>;
    listFiles: Invoke<'fs:list-files'>;
    switch: Invoke<'fs:switch-workspace'>;
    recent: Invoke<'fs:recent-workspaces'>;
    pickFolder: Invoke<'fs:pick-folder'>;
  };
  fs: {
    readScript: Invoke<'fs:read-script'>;
    writeScript: Invoke<'fs:write-script'>;
    deleteEmptyScript: Invoke<'fs:delete-empty-script'>;
    listDir: Invoke<'fs:list-dir'>;
    create: Invoke<'fs:create'>;
    rename: Invoke<'fs:rename'>;
    move: Invoke<'fs:move'>;
    copy: Invoke<'fs:copy'>;
    trash: Invoke<'fs:trash'>;
    reveal: Invoke<'fs:reveal'>;
    openExternal: Invoke<'fs:open-external'>;
    openFileDialog: Invoke<'fs:open-file-dialog'>;
    saveAs: Invoke<'fs:save-as'>;
  };
  conn: {
    list: Invoke<'conn:list'>;
    save: Invoke<'conn:save'>;
    delete: Invoke<'conn:delete'>;
    setLayout: Invoke<'conn:set-layout'>;
    test: Invoke<'conn:test'>;
    connect: Invoke<'conn:connect'>;
    disconnect: Invoke<'conn:disconnect'>;
  };
  meta: {
    children: Invoke<'meta:children'>;
    count: Invoke<'meta:count'>;
  };
  query: {
    execute: Invoke<'query:execute'>;
    fetchMore: Invoke<'query:fetch-more'>;
    cancel: Invoke<'query:cancel'>;
    closeSession: Invoke<'query:close-session'>;
  };
  /** Suscribe a un evento de main. Devuelve la función para desuscribirse. */
  on<C extends IpcEventChannel>(channel: C, listener: (payload: IpcEventPayload<C>) => void): () => void;
}
