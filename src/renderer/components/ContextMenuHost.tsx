import { useCallback } from 'react';
import { useOverlayStore } from '../stores/overlay-store';
import type { MenuEntry } from './menu-types';
import { Menu } from './Menu';

/** Único menú contextual de la ventana. */
export function ContextMenuHost(): React.JSX.Element | null {
  const contextMenu = useOverlayStore((s) => s.contextMenu);
  const close = useOverlayStore((s) => s.closeContextMenu);
  const onClose = useCallback(() => close(), [close]);
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
): void {
  event.preventDefault();
  useOverlayStore.getState().openContextMenu(event.clientX, event.clientY, entries);
}
