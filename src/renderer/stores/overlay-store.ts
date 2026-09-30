import { create } from 'zustand';
import type { MenuEntry } from '../components/menu-types';

export type PaletteMode = 'quickOpen' | 'commands';
export type DialogId = 'about' | 'keybindings';

interface OverlayStore {
  palette: { open: boolean; initialValue: string };
  dialog: DialogId | null;
  contextMenu: { x: number; y: number; entries: MenuEntry[] } | null;
  openPalette: (mode: PaletteMode) => void;
  closePalette: () => void;
  openDialog: (id: DialogId) => void;
  closeDialog: () => void;
  openContextMenu: (x: number, y: number, entries: MenuEntry[]) => void;
  closeContextMenu: () => void;
}

/** Capas flotantes únicas de la ventana: paleta, diálogo y menú contextual. */
export const useOverlayStore = create<OverlayStore>((set) => ({
  palette: { open: false, initialValue: '' },
  dialog: null,
  contextMenu: null,
  openPalette: (mode) => set({ palette: { open: true, initialValue: mode === 'commands' ? '>' : '' } }),
  closePalette: () => set((s) => ({ palette: { ...s.palette, open: false } })),
  openDialog: (id) => set({ dialog: id }),
  closeDialog: () => set({ dialog: null }),
  openContextMenu: (x, y, entries) => set({ contextMenu: { x, y, entries } }),
  closeContextMenu: () => set({ contextMenu: null }),
}));
