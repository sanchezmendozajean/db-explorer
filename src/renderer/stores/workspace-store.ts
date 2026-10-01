import { create } from 'zustand';

interface WorkspaceStore {
  /** Ruta absoluta del espacio de trabajo (specs/11). */
  path: string;
  name: string;
  /** Espacios usados recientemente (el actual primero), para Archivo › Abrir espacio reciente. */
  recent: string[];
  set: (path: string, name: string) => void;
  setRecent: (recent: string[]) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  path: '',
  name: 'DB Explorer',
  recent: [],
  set: (path, name) => set({ path, name }),
  setRecent: (recent) => set({ recent }),
}));
