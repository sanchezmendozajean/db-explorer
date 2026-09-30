import { create } from 'zustand';
import type { MenuEntry } from '../components/menu-types';

export type PaletteMode = 'quickOpen' | 'commands';

/** Diálogos modales (uno a la vez). */
export type DialogState =
  | { id: 'about' }
  | { id: 'keybindings' }
  /** Nueva conexión (`editId` ausente) o edición. `folder`: carpeta inicial al crear. */
  | { id: 'connection'; editId?: string; folder?: string }
  /** Pide la contraseña al conectar. */
  | { id: 'password'; connectionId: string }
  | {
      id: 'confirm';
      title: string;
      message: string;
      confirmLabel: string;
      danger?: boolean;
      onConfirm: () => void;
    }
  | {
      id: 'prompt';
      title: string;
      label: string;
      initialValue: string;
      confirmLabel: string;
      /** Devuelve un mensaje de error o `null` si el valor es válido. */
      validate?: (value: string) => string | null;
      onSubmit: (value: string) => void;
    };

export type DialogId = DialogState['id'];

interface OverlayStore {
  palette: { open: boolean; initialValue: string };
  dialog: DialogState | null;
  contextMenu: { x: number; y: number; entries: MenuEntry[] } | null;
  openPalette: (mode: PaletteMode) => void;
  closePalette: () => void;
  openDialog: (dialog: DialogState) => void;
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
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  openContextMenu: (x, y, entries) => set({ contextMenu: { x, y, entries } }),
  closeContextMenu: () => set({ contextMenu: null }),
}));
