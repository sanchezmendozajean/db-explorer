/** Entradas de menú (menú de la title bar, contextual y desplegables). */
export type MenuEntry =
  | {
      type: 'item';
      id: string;
      label: string;
      keybinding?: string;
      icon?: string;
      disabled?: boolean;
      checked?: boolean;
      run: () => void;
    }
  | { type: 'separator' }
  | { type: 'submenu'; id: string; label: string; disabled?: boolean; entries: MenuEntry[] };

export const SEPARATOR: MenuEntry = { type: 'separator' };
