import { create } from 'zustand';

interface WorkspaceStore {
  /** Ruta absoluta del espacio de trabajo (specs/11). */
  path: string;
  name: string;
  set: (path: string, name: string) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  path: '',
  name: 'DB Explorer',
  set: (path, name) => set({ path, name }),
}));
