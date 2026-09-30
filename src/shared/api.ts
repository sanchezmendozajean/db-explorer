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
  };
  /** Suscribe a un evento de main. Devuelve la función para desuscribirse. */
  on<C extends IpcEventChannel>(channel: C, listener: (payload: IpcEventPayload<C>) => void): () => void;
}
