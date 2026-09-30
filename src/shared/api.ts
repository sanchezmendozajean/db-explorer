import type { IpcEventChannel } from './channels';
import type { IpcEventPayload, IpcResult, PingRequest, PingResult } from './ipc';

/** API mínima que el preload expone al renderer como `window.api`. */
export interface DbExplorerApi {
  app: {
    ping(request: PingRequest): Promise<IpcResult<PingResult>>;
  };
  /** Suscribe a un evento de main. Devuelve la función para desuscribirse. */
  on<C extends IpcEventChannel>(channel: C, listener: (payload: IpcEventPayload<C>) => void): () => void;
}
