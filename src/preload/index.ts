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
