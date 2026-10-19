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
    clipboardRead: Invoke<'app:clipboard-read'>;
    openFileDialog: Invoke<'app:open-file-dialog'>;
    closeReady: Invoke<'app:close-ready'>;
  };
  settings: {
    get: Invoke<'settings:get'>;
    update: Invoke<'settings:update'>;
    getKeybindings: Invoke<'settings:get-keybindings'>;
    openFile: Invoke<'settings:open-file'>;
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
    table: Invoke<'meta:table'>;
    ddl: Invoke<'meta:ddl'>;
    saveRoutine: Invoke<'meta:save-routine'>;
  };
  query: {
    execute: Invoke<'query:execute'>;
    fetchMore: Invoke<'query:fetch-more'>;
    cancel: Invoke<'query:cancel'>;
    closeSession: Invoke<'query:close-session'>;
    endTransaction: Invoke<'query:end-transaction'>;
    historyList: Invoke<'query:history-list'>;
    historyDelete: Invoke<'query:history-delete'>;
    historyClear: Invoke<'query:history-clear'>;
  };
  dbadmin: {
    create: Invoke<'dbadmin:create'>;
    drop: Invoke<'dbadmin:drop'>;
    rename: Invoke<'dbadmin:rename'>;
    backup: Invoke<'dbadmin:backup'>;
    restore: Invoke<'dbadmin:restore'>;
    cancel: Invoke<'dbadmin:cancel'>;
    pickFile: Invoke<'dbadmin:pick-file'>;
  };
  tools: {
    status: Invoke<'tools:status'>;
    pick: Invoke<'tools:pick'>;
    import: Invoke<'tools:import'>;
    remove: Invoke<'tools:remove'>;
    openFolder: Invoke<'tools:open-folder'>;
    /** Ruta en disco de un archivo arrastrado a la ventana (`webUtils.getPathForFile`); vacía si no tiene. */
    pathForFile(file: unknown): string;
  };
  data: {
    apply: Invoke<'data:apply'>;
    pickExportPath: Invoke<'data:pick-export-path'>;
    export: Invoke<'data:export'>;
  };
  updates: {
    getStatus: Invoke<'updates:get-status'>;
    check: Invoke<'updates:check'>;
    install: Invoke<'updates:install'>;
  };
  /** Suscribe a un evento de main. Devuelve la función para desuscribirse. */
  on<C extends IpcEventChannel>(channel: C, listener: (payload: IpcEventPayload<C>) => void): () => void;
}
