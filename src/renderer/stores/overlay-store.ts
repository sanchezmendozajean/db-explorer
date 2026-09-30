import { create } from 'zustand';
import type { MenuEntry } from '../components/menu-types';

export type PaletteMode = 'quickOpen' | 'commands';

/** Lista de selección genérica en la paleta (p. ej. cambiar conexión con Ctrl+9). */
export interface QuickPick {
  placeholder: string;
  items: QuickPickItem[];
}

export interface QuickPickItem {
  id: string;
  label: string;
  icon?: string;
  iconColor?: string;
  detail?: string;
  /** Marca el elemento actual (se preselecciona). */
  current?: boolean;
  run: () => void;
}

export interface ChoiceButton {
  value: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
}

/** Diálogos modales (uno a la vez). */
export type DialogState =
  | { id: 'about' }
  | { id: 'keybindings' }
  /** Nueva conexión (`editId` ausente) o edición. `folder`: carpeta inicial al crear. */
  | { id: 'connection'; editId?: string; folder?: string }
  /** Pide la contraseña al conectar. */
  | { id: 'password'; connectionId: string; onResult?: (connected: boolean) => void }
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
    }
  /** Pregunta con varios botones (p. ej. Guardar / No guardar / Cancelar). Esc = `null`. */
  | {
      id: 'choice';
      title: string;
      message: string;
      /** Lista opcional bajo el mensaje (p. ej. archivos modificados). */
      items?: string[];
      buttons: ChoiceButton[];
      onResult: (value: string | null) => void;
    }
  /** Confirmación antes de ejecutar escrituras (Producción) o UPDATE/DELETE sin WHERE (specs/04 §14). */
  | {
      id: 'writeConfirm';
      connectionName: string;
      production: boolean;
      /** Sentencias que modifican datos o estructura. */
      statements: string[];
      /** Hay UPDATE/DELETE sin WHERE. */
      unbounded: boolean;
      language: string;
      onResult: (result: { confirmed: boolean; dontAskAgain: boolean }) => void;
    };

export type DialogId = DialogState['id'];

interface OverlayStore {
  palette: { open: boolean; initialValue: string; pick: QuickPick | null };
  dialog: DialogState | null;
  contextMenu: { x: number; y: number; entries: MenuEntry[] } | null;
  openPalette: (mode: PaletteMode) => void;
  openPick: (pick: QuickPick) => void;
  closePalette: () => void;
  openDialog: (dialog: DialogState) => void;
  closeDialog: () => void;
  openContextMenu: (x: number, y: number, entries: MenuEntry[]) => void;
  closeContextMenu: () => void;
}

/** Capas flotantes únicas de la ventana: paleta, diálogo y menú contextual. */
export const useOverlayStore = create<OverlayStore>((set) => ({
  palette: { open: false, initialValue: '', pick: null },
  dialog: null,
  contextMenu: null,
  openPalette: (mode) =>
    set({ palette: { open: true, initialValue: mode === 'commands' ? '>' : '', pick: null } }),
  openPick: (pick) => set({ palette: { open: true, initialValue: '', pick } }),
  closePalette: () => set((s) => ({ palette: { ...s.palette, open: false } })),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  openContextMenu: (x, y, entries) => set({ contextMenu: { x, y, entries } }),
  closeContextMenu: () => set({ contextMenu: null }),
}));
