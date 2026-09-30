import { create } from 'zustand';
import type { FileNode } from '@shared/workspace';

interface FilesStore {
  nodes: FileNode[];
  loaded: boolean;
  /** Relee el árbol del espacio de trabajo (el watcher llega en M5). */
  load: () => Promise<void>;
}

export const useFilesStore = create<FilesStore>((set) => ({
  nodes: [],
  loaded: false,
  load: async () => {
    const r = await window.api.workspace.listFiles({});
    if (r.ok) set({ nodes: r.data, loaded: true });
  },
}));

export function refreshFiles(): void {
  void useFilesStore.getState().load();
}
