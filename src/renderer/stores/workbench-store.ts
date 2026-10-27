import { create } from 'zustand';
import type { ObjectKind } from '@shared/metadata';

export type EditorTabKind = 'script' | 'object' | 'routine' | 'preferences';

/** Grupo del editor: 0 = principal (izquierdo), 1 = dividido (derecho). */
export type EditorGroupIndex = 0 | 1;

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
  /** Pestaña de objeto (specs/04 §9): tabla o vista y subpestaña elegida; en `routine`, la rutina editada. */
  object?: { database: string; schema: string; name: string; kind: ObjectKind };
  objectView?: 'data' | 'structure' | 'ddl';
  /** Grupo donde está la pestaña: sin valor, el principal; `1`, el dividido. */
  group?: EditorGroupIndex;
}

export function groupOf(tab: Pick<EditorTab, 'group'> | undefined): EditorGroupIndex {
  return tab?.group === 1 ? 1 : 0;
}

interface WorkbenchStore {
  tabs: EditorTab[];
  /** Pestaña con el foco: la visible del grupo enfocado. */
  activeId: string | null;
  /** Pestaña visible de cada grupo (se deriva de `activeId` y de las pestañas: ver `normalize`). */
  groupActive: [string | null, string | null];
  closed: EditorTab[];
  activate: (id: string) => void;
  /** Activa la pestaña `index` del grupo enfocado. */
  activateIndex: (index: number) => void;
  /** Activa la pestaña siguiente o anterior del grupo enfocado. */
  activateRelative: (delta: 1 | -1) => void;
  close: (id: string) => void;
  closeOthers: (id: string) => void;
  closeToRight: (id: string) => void;
  closeSaved: () => void;
  closeAll: () => void;
  reopenClosed: () => void;
  pin: (id: string) => void;
  /** Mueve una pestaña a otra posición; con `group` también la pasa a ese grupo. */
  move: (id: string, toIndex: number, group?: EditorGroupIndex) => void;
  /** Pasa la pestaña al final del grupo indicado y la activa. */
  moveToGroup: (id: string, group: EditorGroupIndex) => void;
  /** Lleva todas las pestañas del grupo dividido al principal. */
  mergeGroups: () => void;
  /** Da el foco a un grupo (activa su pestaña visible). */
  focusGroup: (group: EditorGroupIndex) => void;
  /** Abre (o enfoca) una pestaña en el grupo enfocado; si es preview, reemplaza a la preview del grupo. */
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

/** Pestaña que queda activa al quitar `ids`: la vecina del mismo grupo; si no hay, cualquier otra. */
function nextActive(before: EditorTab[], ids: readonly string[], activeId: string): string | null {
  const after = before.filter((t) => !ids.includes(t.id));
  const active = before.find((t) => t.id === activeId);
  if (!active) return after[0]?.id ?? null;
  const peers = before.filter((t) => groupOf(t) === groupOf(active));
  const kept = peers.filter((t) => !ids.includes(t.id));
  const next =
    kept[Math.min(peers.indexOf(active), kept.length - 1)] ??
    after[Math.min(before.indexOf(active), after.length - 1)];
  return next?.id ?? null;
}

/**
 * Mantiene coherentes los grupos tras cualquier cambio: sin pestañas en el principal, las del
 * dividido pasan a él; la pestaña activa es la visible de su grupo y cada grupo muestra una pestaña suya.
 */
function normalize(s: WorkbenchStore, patch: Partial<WorkbenchStore>): Partial<WorkbenchStore> {
  const original = patch.tabs ?? s.tabs;
  let tabs = original;
  const activeId = 'activeId' in patch ? (patch.activeId ?? null) : s.activeId;
  if (!tabs.some((t) => groupOf(t) === 0) && tabs.some((t) => groupOf(t) === 1)) {
    tabs = tabs.map((t) => ({ ...t, group: undefined }));
  }
  const groupActive: [string | null, string | null] = [s.groupActive[0], s.groupActive[1]];
  const active = tabs.find((t) => t.id === activeId);
  if (active) groupActive[groupOf(active)] = active.id;
  for (const g of [0, 1] as const) {
    if (!tabs.some((t) => t.id === groupActive[g] && groupOf(t) === g)) {
      groupActive[g] = tabs.findLast((t) => groupOf(t) === g)?.id ?? null;
    }
  }
  const out: Partial<WorkbenchStore> = { ...patch, groupActive };
  if (tabs !== original) out.tabs = tabs;
  return out;
}

export const useWorkbenchStore = create<WorkbenchStore>((rawSet, get) => {
  const set = (update: Partial<WorkbenchStore> | ((s: WorkbenchStore) => Partial<WorkbenchStore>)): void =>
    rawSet((s) => {
      const patch = typeof update === 'function' ? update(s) : update;
      return patch === s ? s : normalize(s, patch);
    });

  /** Pestañas del grupo enfocado (el de la pestaña activa). */
  const focusedTabs = (): EditorTab[] => {
    const { tabs, activeId } = get();
    const group = groupOf(tabs.find((t) => t.id === activeId));
    return tabs.filter((t) => groupOf(t) === group);
  };

  return {
    tabs: [],
    activeId: null,
    groupActive: [null, null],

    closed: [],

    activate: (id) => set({ activeId: id }),

    activateIndex: (index) => {
      const tab = focusedTabs()[index];
      if (tab) set({ activeId: tab.id });
    },

    activateRelative: (delta) => {
      const tabs = focusedTabs();
      if (tabs.length === 0) return;
      const current = tabs.findIndex((t) => t.id === get().activeId);
      const next = (current + delta + tabs.length) % tabs.length;
      set({ activeId: tabs[next]!.id });
    },

    close: (id) =>
      set((s) => {
        const tab = s.tabs.find((t) => t.id === id);
        if (!tab) return s;
        return {
          tabs: s.tabs.filter((t) => t.id !== id),
          activeId: s.activeId === id ? nextActive(s.tabs, [id], id) : s.activeId,
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

    move: (id, toIndex, group) =>
      set((s) => {
        const from = s.tabs.findIndex((t) => t.id === id);
        if (from < 0) return s;
        const tabs = [...s.tabs];
        const [tab] = tabs.splice(from, 1);
        const moved = group === undefined ? tab! : { ...tab!, group: group === 1 ? (1 as const) : undefined };
        tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, moved);
        return group !== undefined && group !== groupOf(tab) ? { tabs, activeId: id } : { tabs };
      }),

    moveToGroup: (id, group) =>
      set((s) => {
        const tab = s.tabs.find((t) => t.id === id);
        if (!tab) return s;
        const moved = { ...tab, group: group === 1 ? (1 as const) : undefined };
        return { tabs: [...s.tabs.filter((t) => t.id !== id), moved], activeId: id };
      }),

    mergeGroups: () =>
      set((s) => ({ tabs: s.tabs.map((t) => (t.group === 1 ? { ...t, group: undefined } : t)) })),

    focusGroup: (group) => {
      const id = get().groupActive[group];
      if (id && id !== get().activeId) set({ activeId: id });
    },

    update: (id, patch) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),

    remove: (ids, options = {}) =>
      set((s) => {
        const removed = s.tabs.filter((t) => ids.includes(t.id));
        if (removed.length === 0) return s;
        const tabs = s.tabs.filter((t) => !ids.includes(t.id));
        const activeId =
          s.activeId && ids.includes(s.activeId) ? nextActive(s.tabs, ids, s.activeId) : s.activeId;
        const closed = options.remember === false ? s.closed : [...s.closed, ...removed].slice(-MAX_CLOSED);
        return { tabs, activeId, closed };
      }),

    restore: (tabs, activeId) => set({ tabs, activeId: activeId ?? tabs[0]?.id ?? null, closed: [] }),

    forgetClosed: (ids) => set((s) => ({ closed: s.closed.filter((t) => !ids.includes(t.id)) })),

    open: (tab) =>
      set((s) => {
        if (s.tabs.some((t) => t.id === tab.id)) return { activeId: tab.id };
        const group = tab.group ?? groupOf(s.tabs.find((t) => t.id === s.activeId));
        const placed = { ...tab, group: group === 1 ? (1 as const) : undefined };
        if (tab.preview) {
          const previewIndex = s.tabs.findIndex((t) => t.preview && groupOf(t) === group);
          if (previewIndex >= 0) {
            const tabs = [...s.tabs];
            tabs[previewIndex] = placed;
            return { tabs, activeId: tab.id };
          }
        }
        return { tabs: [...s.tabs, placed], activeId: tab.id };
      }),
  };
});

export function activeTab(): EditorTab | undefined {
  const { tabs, activeId } = useWorkbenchStore.getState();
  return tabs.find((t) => t.id === activeId);
}
