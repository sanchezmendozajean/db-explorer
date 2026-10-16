import { create } from 'zustand';
import type { FileNode } from '@shared/workspace';

/** Linux distingue mayúsculas en las rutas; Windows y macOS no. */
const CASE_SENSITIVE_PATHS = typeof navigator !== 'undefined' && /Linux/.test(navigator.userAgent);

/** Clave de una ruta (en Windows no se distingue mayúsculas; en Linux sí). */
export function pathKey(path: string): string {
  return CASE_SENSITIVE_PATHS ? path : path.toLowerCase();
}

/** Carpeta que contiene una ruta. */
export function parentOf(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return i > 0 ? path.slice(0, i) : path;
}

/** ¿`path` está dentro de `dir` (o es la misma ruta)? */
export function isInside(dir: string, path: string): boolean {
  const d = pathKey(dir).replace(/[\\/]+$/, '');
  const p = pathKey(path);
  return p === d || p.startsWith(`${d}\\`) || p.startsWith(`${d}/`);
}

/** Edición en línea en el árbol: renombrar un nodo o crear uno nuevo en una carpeta. */
export type FileEditing =
  { kind: 'rename'; path: string } | { kind: 'new'; dir: string; type: 'file' | 'folder' };

interface FilesStore {
  root: string;
  /** Contenido de las carpetas ya leídas, por `pathKey`. */
  dirs: Record<string, FileNode[]>;
  /** Carpetas expandidas, por `pathKey`. */
  expanded: Set<string>;
  /** Nodo con el foco (el que usan Renombrar, Nuevo…, Duplicar). */
  selected: string | null;
  /** Selección múltiple (incluye `selected`); las operaciones de lote (copiar, cortar, eliminar, mover) la usan. */
  selection: string[];
  /** Extremo fijo de una selección con Shift. */
  anchor: string | null;
  editing: FileEditing | null;
  /** Archivos copiados o cortados con Ctrl+C / Ctrl+X en el árbol. */
  clipboard: { paths: string[]; cut: boolean } | null;
  /** Árbol completo del espacio para Ctrl+P (se carga al abrir la paleta). */
  all: FileNode[];

  setRoot: (root: string) => void;
  loadDir: (path: string) => Promise<void>;
  /** Vuelve a leer las carpetas afectadas por rutas que cambiaron en disco. */
  refresh: (paths: readonly string[]) => Promise<void>;
  toggle: (path: string, open: boolean) => Promise<void>;
  collapseAll: () => void;
  select: (path: string | null) => void;
  /** Ctrl+clic suma o quita `path`; Shift+clic selecciona el rango desde el ancla (en el orden visible `order`). */
  selectWith: (path: string, mode: 'toggle' | 'range', order: readonly string[]) => void;
  setEditing: (editing: FileEditing | null) => void;
  setClipboard: (clipboard: FilesStore['clipboard']) => void;
  /** Expande las carpetas hasta `path` y lo selecciona (sincronizar con la pestaña activa). */
  reveal: (path: string) => Promise<void>;
  loadAll: () => Promise<void>;
}

export const useFilesStore = create<FilesStore>((set, get) => ({
  root: '',
  dirs: {},
  expanded: new Set(),
  selected: null,
  selection: [],
  anchor: null,
  editing: null,
  clipboard: null,
  all: [],

  setRoot: (root) => {
    set({
      root,
      dirs: {},
      expanded: new Set(),
      selected: null,
      selection: [],
      anchor: null,
      editing: null,
      clipboard: null,
      all: [],
    });
    if (root) void get().loadDir(root);
  },

  loadDir: async (path) => {
    const r = await window.api.fs.listDir({ path });
    const key = pathKey(path);
    if (r.ok) set((s) => ({ dirs: { ...s.dirs, [key]: r.data } }));
    else if (r.error.code === 'not-found') {
      // La carpeta ya no existe: se olvida (y se colapsa).
      set((s) => {
        const dirs = Object.fromEntries(Object.entries(s.dirs).filter(([k]) => k !== key));
        const expanded = new Set(s.expanded);
        expanded.delete(key);
        return { dirs, expanded };
      });
    }
  },

  refresh: async (paths) => {
    const { dirs, root } = get();
    const reload = new Set<string>();
    for (const path of paths) {
      const parent = parentOf(path);
      if (dirs[pathKey(parent)]) reload.add(parent);
      if (dirs[pathKey(path)]) reload.add(path);
    }
    if (paths.length === 0 && root) reload.add(root);
    await Promise.all([...reload].map((dir) => get().loadDir(dir)));
  },

  toggle: async (path, open) => {
    const key = pathKey(path);
    set((s) => {
      const expanded = new Set(s.expanded);
      if (open) expanded.add(key);
      else expanded.delete(key);
      return { expanded };
    });
    if (open && !get().dirs[key]) await get().loadDir(path);
  },

  collapseAll: () => set({ expanded: new Set() }),

  select: (path) => set({ selected: path, selection: path ? [path] : [], anchor: path }),

  selectWith: (path, mode, order) => {
    const { selection, anchor } = get();
    const key = pathKey(path);
    if (mode === 'toggle') {
      const has = selection.some((p) => pathKey(p) === key);
      const next = has ? selection.filter((p) => pathKey(p) !== key) : [...selection, path];
      set({ selection: next, selected: has ? (next[next.length - 1] ?? null) : path, anchor: path });
      return;
    }
    const keys = order.map(pathKey);
    const from = keys.indexOf(pathKey(anchor ?? path));
    const to = keys.indexOf(key);
    if (from < 0 || to < 0) {
      set({ selected: path, selection: [path], anchor: path });
      return;
    }
    const [a, b] = from <= to ? [from, to] : [to, from];
    set({ selected: path, selection: order.slice(a, b + 1) });
  },

  setEditing: (editing) => set({ editing }),

  setClipboard: (clipboard) => set({ clipboard }),

  reveal: async (path) => {
    const { root } = get();
    if (!root || !isInside(root, path)) return;
    const chain: string[] = [];
    for (
      let dir = parentOf(path);
      isInside(root, dir) && pathKey(dir) !== pathKey(root);
      dir = parentOf(dir)
    ) {
      chain.unshift(dir);
    }
    for (const dir of chain) await get().toggle(dir, true);
    set({ selected: path, selection: [path], anchor: path });
  },

  loadAll: async () => {
    const r = await window.api.workspace.listFiles({});
    if (r.ok) set({ all: r.data });
  },
}));

/** Relee la raíz y las carpetas abiertas (botón Actualizar). */
export function refreshFiles(): void {
  const { root, dirs } = useFilesStore.getState();
  if (!root) return;
  const loaded = Object.keys(dirs);
  void Promise.all([
    useFilesStore.getState().loadDir(root),
    ...loaded.map((key) => {
      const node = findNode(key);
      return node ? useFilesStore.getState().loadDir(node) : Promise.resolve();
    }),
  ]);
}

/** Ruta original (con mayúsculas) de una carpeta cargada a partir de su clave. */
function findNode(key: string): string | null {
  const { dirs, root } = useFilesStore.getState();
  if (pathKey(root) === key) return null;
  for (const nodes of Object.values(dirs)) {
    const hit = nodes.find((n) => pathKey(n.path) === key);
    if (hit) return hit.path;
  }
  return null;
}
