import { useCallback } from 'react';
import { useOverlayStore } from '../stores/overlay-store';
import type { MenuEntry } from './menu-types';
import { Menu } from './Menu';
import type { MenuCloseReason } from './Menu';

/** Cómo devolver el foco al cerrar el menú (por defecto, al elemento que lo tenía al abrirlo, como en VS Code). */
let restoreFocus: (() => void) | null = null;

/** Único menú contextual de la ventana. */
export function ContextMenuHost(): React.JSX.Element | null {
  const contextMenu = useOverlayStore((s) => s.contextMenu);
  const close = useOverlayStore((s) => s.closeContextMenu);
  const onClose = useCallback(
    (reason: MenuCloseReason) => {
      close();
      // Un clic fuera ya lleva el foco a otro lugar; en los demás casos vuelve a donde estaba.
      if (reason !== 'outside') restoreFocus?.();
      restoreFocus = null;
    },
    [close],
  );
  if (!contextMenu) return null;
  return (
    <Menu
      entries={contextMenu.entries}
      x={contextMenu.x}
      y={contextMenu.y}
      onClose={onClose}
      initialIndex={-1}
    />
  );
}

/** Abre el menú contextual en la posición del evento. */
export function showContextMenu(
  event: { clientX: number; clientY: number; preventDefault: () => void },
  entries: MenuEntry[],
  options: { restoreFocus?: () => void } = {},
): void {
  event.preventDefault();
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  restoreFocus = options.restoreFocus ?? (() => previous?.focus());
  useOverlayStore.getState().openContextMenu(event.clientX, event.clientY, entries);
}
