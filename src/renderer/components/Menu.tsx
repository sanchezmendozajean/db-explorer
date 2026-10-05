import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MenuEntry } from './menu-types';
import { Codicon } from './Codicon';

export type MenuCloseReason = 'select' | 'escape' | 'outside' | 'tab';

export interface MenuProps {
  entries: MenuEntry[];
  /** Posición preferida (esquina superior izquierda). */
  x: number;
  y: number;
  /** Si no cabe a la derecha, se alinea con su borde derecho en esta x (submenús). */
  flipX?: number;
  onClose: (reason: MenuCloseReason) => void;
  /** Flechas ←/→ en el menú raíz (para saltar entre menús de la title bar). */
  onNavigate?: (direction: 'left' | 'right') => void;
  /** Elementos cuyo clic no cuenta como "fuera" (p. ej. el botón que abrió el menú). */
  isInsideAnchor?: (target: Element) => boolean;
  /** Enfoca el menú al abrir (true al abrir con teclado o clic). */
  autoFocus?: boolean;
  /** Índice inicialmente activo (-1 = ninguno). */
  initialIndex?: number;
  level?: number;
  ariaLabel?: string;
}

const isSelectable = (e: MenuEntry | undefined): boolean => !!e && e.type !== 'separator' && !e.disabled;

function step(entries: MenuEntry[], from: number, delta: 1 | -1): number {
  const n = entries.length;
  for (let i = 1; i <= n; i++) {
    const idx = (((from + delta * i) % n) + n) % n;
    if (isSelectable(entries[idx])) return idx;
  }
  return from;
}

/** Menú estilo VS Code con submenús y navegación por teclado. */
export function Menu({
  entries,
  x,
  y,
  flipX,
  onClose,
  onNavigate,
  isInsideAnchor,
  autoFocus = true,
  initialIndex = -1,
  level = 0,
  ariaLabel,
}: MenuProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState(initialIndex);
  const [submenu, setSubmenuState] = useState<{ index: number; focus: boolean; rect: DOMRect } | null>(null);
  const [position, setPosition] = useState({ left: x, top: y, visible: false });
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Abre el submenú del ítem `index`, guardando la posición del ítem (no se leen refs durante el render). */
  const setSubmenu = useCallback((next: { index: number; focus: boolean } | null) => {
    const rect = next ? itemRefs.current[next.index]?.getBoundingClientRect() : undefined;
    setSubmenuState(next && rect ? { ...next, rect } : null);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + width > window.innerWidth)
      left = flipX !== undefined ? flipX - width : window.innerWidth - width - 4;
    if (top + height > window.innerHeight) top = Math.max(4, window.innerHeight - height - 4);
    setPosition({ left: Math.max(0, left), top, visible: true });
  }, [x, y, flipX]);

  // Se enfoca cuando ya es visible: un elemento con `visibility: hidden` no puede recibir el foco.
  useEffect(() => {
    if (autoFocus && position.visible) ref.current?.focus();
  }, [autoFocus, position.visible]);

  // Solo el menú raíz escucha clics fuera; los submenús se cierran con él.
  useEffect(() => {
    if (level > 0) return;
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Element | null;
      if (!target) return;
      if (target.closest('.menu')) return;
      if (isInsideAnchor?.(target)) return;
      onClose('outside');
    };
    const onBlur = (): void => onClose('outside');
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [level, onClose, isInsideAnchor]);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const activate = useCallback(
    (index: number) => {
      const entry = entries[index];
      if (!entry || entry.type === 'separator' || entry.disabled) return;
      if (entry.type === 'submenu') {
        setSubmenu({ index, focus: true });
        return;
      }
      onClose('select');
      entry.run();
    },
    [entries, onClose, setSubmenu],
  );

  const onKeyDown = (e: React.KeyboardEvent): void => {
    // Las teclas de un submenú enfocado no deben procesarse también en el padre.
    if (e.target !== ref.current) return;
    switch (e.key) {
      case 'ArrowDown':
        setActive((a) => step(entries, a < 0 ? -1 : a, 1));
        break;
      case 'ArrowUp':
        setActive((a) => step(entries, a < 0 ? entries.length : a, -1));
        break;
      case 'Home':
        setActive(step(entries, -1, 1));
        break;
      case 'End':
        setActive(step(entries, entries.length, -1));
        break;
      case 'ArrowRight':
        if (entries[active]?.type === 'submenu' && isSelectable(entries[active]))
          setSubmenu({ index: active, focus: true });
        else onNavigate?.('right');
        break;
      case 'ArrowLeft':
        if (level > 0) onClose('escape');
        else onNavigate?.('left');
        break;
      case 'Enter':
      case ' ':
        if (active >= 0) activate(active);
        break;
      case 'Escape':
        onClose('escape');
        break;
      case 'Tab':
        onClose('tab');
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const onItemEnter = (index: number): void => {
    setActive(index);
    clearTimeout(hoverTimer.current);
    const entry = entries[index];
    hoverTimer.current = setTimeout(() => {
      if (entry?.type === 'submenu' && !entry.disabled) setSubmenu({ index, focus: false });
      else setSubmenu(null);
    }, 150);
  };

  const openSub = submenu ? entries[submenu.index] : undefined;
  const subRect = submenu?.rect;

  const menu = (
    <div
      ref={ref}
      className="menu"
      role="menu"
      aria-label={ariaLabel}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: position.left, top: position.top, visibility: position.visible ? 'visible' : 'hidden' }}
    >
      {entries.map((entry, index) => {
        if (entry.type === 'separator')
          return <div key={`sep-${index}`} className="menu-separator" role="separator" />;
        const isActive = index === active;
        return (
          <div
            key={entry.id}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            role="menuitem"
            aria-disabled={entry.disabled || undefined}
            aria-haspopup={entry.type === 'submenu' || undefined}
            aria-checked={entry.type === 'item' && entry.checked !== undefined ? entry.checked : undefined}
            title={entry.type === 'item' ? entry.title : undefined}
            className={['menu-item', isActive ? 'is-active' : '', entry.disabled ? 'is-disabled' : ''].join(
              ' ',
            )}
            onMouseEnter={() => onItemEnter(index)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => activate(index)}
          >
            <span className="menu-check">
              {entry.type === 'item' && entry.checked && <Codicon name="check" size={14} />}
            </span>
            <span className="menu-label">{entry.label}</span>
            {entry.type === 'item' && entry.keybinding && (
              <span className="menu-keybinding">{entry.keybinding}</span>
            )}
            {entry.type === 'submenu' && <Codicon name="chevron-right" size={14} className="menu-chevron" />}
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      {level === 0 ? createPortal(menu, document.body) : menu}
      {openSub?.type === 'submenu' &&
        subRect &&
        createPortal(
          <Menu
            entries={openSub.entries}
            x={subRect.right - 2}
            y={subRect.top - 4}
            flipX={subRect.left + 2}
            level={level + 1}
            autoFocus={submenu?.focus ?? false}
            initialIndex={submenu?.focus ? step(openSub.entries, -1, 1) : -1}
            onClose={(reason) => {
              setSubmenu(null);
              if (reason === 'escape') ref.current?.focus();
              else onClose(reason);
            }}
          />,
          document.body,
        )}
    </>
  );
}
