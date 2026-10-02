import { create } from 'zustand';

export type EditorTabKind = 'script' | 'object' | 'preferences';

export interface EditorTab {
  id: string;
  kind: EditorTabKind;
  title: string;
  tooltip: string;
  /** Ruta absoluta del archivo (scripts). */
  path?: string;
  connectionId?: string;
  /** Base y esquema elegidos en la barra del editor (sin valor: los predeterminados de la conexión). */
  database?: string;
  schema?: string;
  dirty: boolean;
  /** Pestaña de vista previa (cursiva): se reemplaza al abrir otra desde el árbol. */
  preview: boolean;
}

interface WorkbenchStore {
  tabs: EditorTab[];
  activeId: string | null;
  closed: EditorTab[];
  activate: (id: string) => void;
  activateIndex: (index: number) => void;
  activateRelative: (delta: 1 | -1) => void;
  close: (id: string) => void;
  closeOthers: (id: string) => void;
  closeToRight: (id: string) => void;
  closeSaved: () => void;
  closeAll: () => void;
  reopenClosed: () => void;
  pin: (id: string) => void;
  move: (id: string, toIndex: number) => void;
  /** Abre (o enfoca) una pestaña; si es preview, reemplaza a la preview existente. */
  open: (tab: EditorTab) => void;
  /** Cambia campos de una pestaña (cambios sin guardar, conexión, base…). */
  update: (id: string, patch: Partial<Omit<EditorTab, 'id' | 'kind'>>) => void;
  /** Quita pestañas ya confirmadas para cerrar (las guarda para "Reabrir pestaña cerrada"). */
  remove: (ids: readonly string[], options?: { remember?: boolean }) => void;
  /** Reemplaza todas las pestañas (restauración del espacio de trabajo). */
  restore: (tabs: EditorTab[], activeId: string | null) => void;
  /** Olvida pestañas cerradas (p. ej. scripts vacíos eliminados de disco). */
  forgetClosed: (ids: readonly string[]) => void;
}

const MAX_CLOSED = 20;

function nextActive(tabs: EditorTab[], removedIndex: number): string | null {
  if (tabs.length === 0) return null;
  return tabs[Math.min(removedIndex, tabs.length - 1)]!.id;
}

export const useWorkbenchStore = create<WorkbenchStore>((set, get) => ({
  tabs: [],
  activeId: null,

  closed: [],

  activate: (id) => set({ activeId: id }),

  activateIndex: (index) => {
    const tab = get().tabs[index];
    if (tab) set({ activeId: tab.id });
  },

  activateRelative: (delta) => {
    const { tabs, activeId } = get();
    if (tabs.length === 0) return;
    const current = tabs.findIndex((t) => t.id === activeId);
    const next = (current + delta + tabs.length) % tabs.length;
    set({ activeId: tabs[next]!.id });
  },

  close: (id) =>
    set((s) => {
      const index = s.tabs.findIndex((t) => t.id === id);
      if (index < 0) return s;
      const tab = s.tabs[index]!;
      const tabs = s.tabs.filter((t) => t.id !== id);
      return {
        tabs,
        activeId: s.activeId === id ? nextActive(tabs, index) : s.activeId,
        closed: [...s.closed, tab].slice(-MAX_CLOSED),
      };
    }),

  closeOthers: (id) =>
    set((s) => ({
      tabs: s.tabs.filter((t) => t.id === id),
      activeId: id,
      closed: [...s.closed, ...s.tabs.filter((t) => t.id !== id)].slice(-MAX_CLOSED),
    })),

  closeToRight: (id) =>
    set((s) => {
      const index = s.tabs.findIndex((t) => t.id === id);
      const kept = s.tabs.slice(0, index + 1);
      const removed = s.tabs.slice(index + 1);
      const activeKept = kept.some((t) => t.id === s.activeId);
      return {
        tabs: kept,
        activeId: activeKept ? s.activeId : id,
        closed: [...s.closed, ...removed].slice(-MAX_CLOSED),
      };
    }),

  closeSaved: () =>
    set((s) => {
      const kept = s.tabs.filter((t) => t.dirty);
      const activeKept = kept.some((t) => t.id === s.activeId);
      return {
        tabs: kept,
        activeId: activeKept ? s.activeId : (kept[0]?.id ?? null),
        closed: [...s.closed, ...s.tabs.filter((t) => !t.dirty)].slice(-MAX_CLOSED),
      };
    }),

  closeAll: () =>
    set((s) => ({ tabs: [], activeId: null, closed: [...s.closed, ...s.tabs].slice(-MAX_CLOSED) })),

  reopenClosed: () =>
    set((s) => {
      const tab = s.closed[s.closed.length - 1];
      if (!tab) return s;
      return { tabs: [...s.tabs, tab], activeId: tab.id, closed: s.closed.slice(0, -1) };
    }),

  pin: (id) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, preview: false } : t)) })),

  move: (id, toIndex) =>
    set((s) => {
      const from = s.tabs.findIndex((t) => t.id === id);
      if (from < 0) return s;
      const tabs = [...s.tabs];
      const [tab] = tabs.splice(from, 1);
      tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab!);
      return { tabs };
    }),

  update: (id, patch) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),

  remove: (ids, options = {}) =>
    set((s) => {
      const removed = s.tabs.filter((t) => ids.includes(t.id));
      if (removed.length === 0) return s;
      const tabs = s.tabs.filter((t) => !ids.includes(t.id));
      let activeId = s.activeId;
      if (activeId && ids.includes(activeId)) {
        const index = s.tabs.findIndex((t) => t.id === activeId);
        activeId = nextActive(tabs, Math.min(index, tabs.length));
      }
      const closed = options.remember === false ? s.closed : [...s.closed, ...removed].slice(-MAX_CLOSED);
      return { tabs, activeId, closed };
    }),

  restore: (tabs, activeId) => set({ tabs, activeId: activeId ?? tabs[0]?.id ?? null, closed: [] }),

  forgetClosed: (ids) => set((s) => ({ closed: s.closed.filter((t) => !ids.includes(t.id)) })),

  open: (tab) =>
    set((s) => {
      if (s.tabs.some((t) => t.id === tab.id)) return { activeId: tab.id };
      if (tab.preview) {
        const previewIndex = s.tabs.findIndex((t) => t.preview);
        if (previewIndex >= 0) {
          const tabs = [...s.tabs];
          tabs[previewIndex] = tab;
          return { tabs, activeId: tab.id };
        }
      }
      return { tabs: [...s.tabs, tab], activeId: tab.id };
    }),
}));

export function activeTab(): EditorTab | undefined {
  const { tabs, activeId } = useWorkbenchStore.getState();
  return tabs.find((t) => t.id === activeId);
}
