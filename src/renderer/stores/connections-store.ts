import { create } from 'zustand';
import type { ConnectionConfig, ConnectionStatus } from '@shared/connection';
import type { IpcError, IpcResult } from '@shared/ipc';
import type { TreeNodeData, TreeNodeRef } from '@shared/metadata';
import { nodeKey } from '@shared/metadata';

export interface TreeTarget {
  connectionId: string;
  database?: string;
  schema?: string;
}

export type ConnectResult = { ok: true } | { ok: false; passwordRequired: boolean; error: IpcError };

interface ConnectionsStore {
  loaded: boolean;
  folders: string[];
  connections: ConnectionConfig[];
  savedPasswordIds: ReadonlySet<string>;
  encryptionAvailable: boolean;
  status: Record<string, ConnectionStatus>;
  /** Hijos cargados por clave de nodo (`nodeKey`). */
  children: Record<string, TreeNodeData[]>;
  loading: Record<string, true>;
  nodeErrors: Record<string, string>;
  /** Conexión que el árbol debe expandir cuando termine de conectar (tras pedir la contraseña). */
  expandOnConnect: string | null;
  /** Conexión, base y esquema del nodo seleccionado en el árbol (destino de "Nuevo script"). */
  treeSelection: TreeTarget | null;
  /** Pedido de mostrar un nodo en el árbol (F12, Ctrl+P): claves de la ruta, de la conexión al nodo. */
  revealRequest: { connectionId: string; keys: string[] } | null;
  reveal: (connectionId: string, keys: string[]) => void;

  /** Devuelve la cantidad de entradas inválidas omitidas al leer el archivo. */
  load: () => Promise<number>;
  save: (
    config: ConnectionConfig,
    options?: { password?: string | null; copyPasswordFrom?: string },
  ) => Promise<IpcResult<{ config: ConnectionConfig }>>;
  remove: (id: string) => Promise<void>;
  setLayout: (folders: string[], order: { id: string; folder?: string }[]) => Promise<void>;
  connect: (id: string, password?: string) => Promise<ConnectResult>;
  disconnect: (id: string) => Promise<void>;
  loadChildren: (connectionId: string, ref: TreeNodeRef, force?: boolean) => Promise<void>;
  /** El db-host se reinició: todas las conexiones quedan cerradas. */
  resetSessions: () => void;
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

function withoutConnection<T>(record: Record<string, T>, connectionId: string): Record<string, T> {
  const prefix = nodeKey(connectionId, { kind: 'connection' });
  return Object.fromEntries(
    Object.entries(record).filter(([k]) => k !== prefix && !k.startsWith(`${prefix}/`)),
  );
}

/** Quita los hijos cargados bajo un nodo (para refrescarlo). */
function withoutSubtree<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key && !k.startsWith(`${key}/`)));
}

export const useConnectionsStore = create<ConnectionsStore>((set, get) => ({
  loaded: false,
  folders: [],
  connections: [],
  savedPasswordIds: new Set(),
  encryptionAvailable: false,
  status: {},
  children: {},
  loading: {},
  nodeErrors: {},
  expandOnConnect: null,
  treeSelection: null,
  revealRequest: null,
  reveal: (connectionId, keys) => set({ revealRequest: { connectionId, keys } }),

  load: async () => {
    const r = await window.api.conn.list({});
    if (!r.ok) return 0;
    set({
      loaded: true,
      folders: r.data.folders,
      connections: r.data.connections,
      savedPasswordIds: new Set(r.data.savedPasswordIds),
      encryptionAvailable: r.data.encryptionAvailable,
    });
    return r.data.skipped;
  },

  save: async (config, options = {}) => {
    const r = await window.api.conn.save({ config, ...options });
    if (r.ok) {
      // Una conexión editada se cierra en main: se refleja aquí.
      set((s) => ({
        status: { ...s.status, [config.id]: { state: 'disconnected' } },
        children: withoutConnection(s.children, config.id),
        nodeErrors: withoutConnection(s.nodeErrors, config.id),
      }));
      await get().load();
    }
    return r;
  },

  remove: async (id) => {
    await window.api.conn.delete({ id });
    set((s) => ({ status: omit(s.status, id), children: withoutConnection(s.children, id) }));
    await get().load();
  },

  setLayout: async (folders, order) => {
    // Optimista: el árbol cambia al instante; si falla, se recarga lo guardado.
    const byId = new Map(get().connections.map((c) => [c.id, c]));
    set({
      folders,
      connections: order.map(({ id, folder }) => {
        const c = { ...byId.get(id)! };
        if (folder) c.folder = folder;
        else delete c.folder;
        return c;
      }),
    });
    const r = await window.api.conn.setLayout({ folders, order });
    if (!r.ok) await get().load();
  },

  connect: async (id, password) => {
    set((s) => ({ status: { ...s.status, [id]: { state: 'connecting' } } }));
    const r = await window.api.conn.connect({ id, password });
    if (r.ok) {
      set((s) => ({
        status: { ...s.status, [id]: { state: 'connected', server: r.data } },
        children: withoutConnection(s.children, id),
        nodeErrors: withoutConnection(s.nodeErrors, id),
      }));
      return { ok: true };
    }
    const passwordRequired = r.error.code === 'password-required';
    set((s) => ({
      status: {
        ...s.status,
        [id]: passwordRequired ? { state: 'disconnected' } : { state: 'error', message: r.error.message },
      },
    }));
    return { ok: false, passwordRequired, error: r.error };
  },

  disconnect: async (id) => {
    await window.api.conn.disconnect({ id });
    set((s) => ({
      status: { ...s.status, [id]: { state: 'disconnected' } },
      children: withoutConnection(s.children, id),
      nodeErrors: withoutConnection(s.nodeErrors, id),
    }));
  },

  loadChildren: async (connectionId, ref, force = false) => {
    const key = nodeKey(connectionId, ref);
    const state = get();
    if (state.loading[key]) return;
    if (!force && state.children[key]) return;
    set((s) => ({
      loading: { ...s.loading, [key]: true },
      ...(force
        ? { children: withoutSubtree(s.children, key), nodeErrors: withoutSubtree(s.nodeErrors, key) }
        : {}),
    }));
    const r = await window.api.meta.children({ connectionId, ref });
    set((s) => {
      const loading = omit(s.loading, key);
      if (r.ok)
        return { loading, children: { ...s.children, [key]: r.data }, nodeErrors: omit(s.nodeErrors, key) };
      return { loading, nodeErrors: { ...s.nodeErrors, [key]: r.error.message } };
    });
  },

  resetSessions: () => set({ status: {}, children: {}, loading: {}, nodeErrors: {} }),
}));

export function connectionById(id: string | undefined): ConnectionConfig | undefined {
  return useConnectionsStore.getState().connections.find((c) => c.id === id);
}
