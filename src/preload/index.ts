/**
 * Preload (sandbox): expone una API mínima y tipada como `window.api`.
 * Nunca se expone `ipcRenderer` completo.
 */
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { DbExplorerApi } from '@shared/api';
import { IPC_EVENT_CHANNELS } from '@shared/channels';
import type { IpcEventChannel } from '@shared/channels';
import type { IpcEventPayload } from '@shared/ipc';

const allowedEvents: readonly string[] = IPC_EVENT_CHANNELS;

const api: DbExplorerApi = {
  app: {
    ping: (request) => ipcRenderer.invoke('app:ping', request),
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
