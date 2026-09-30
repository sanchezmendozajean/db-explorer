import type { ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';
import type { MenuEntry } from './menu-types';
import { Menu } from './Menu';
import { Codicon } from './Codicon';

export interface DropdownProps {
  entries: MenuEntry[] | (() => MenuEntry[]);
  children: ReactNode;
  className?: string;
  title?: string;
  /** Muestra el chevron ▾ al final. */
  chevron?: boolean;
  disabled?: boolean;
  testId?: string;
}

/** Botón que abre un menú desplegable debajo de sí. */
export function Dropdown({
  entries,
  children,
  className,
  title,
  chevron = true,
  disabled,
  testId,
}: DropdownProps): React.JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<DOMRect | null>(null);

  const close = useCallback((reason: string) => {
    setOpen(null);
    if (reason !== 'outside') buttonRef.current?.focus();
  }, []);

  const isInsideAnchor = useCallback((target: Element) => !!buttonRef.current?.contains(target), []);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-testid={testId}
        className={['dropdown', open ? 'is-open' : '', className ?? ''].join(' ')}
        title={title}
        aria-haspopup="menu"
        aria-expanded={!!open}
        disabled={disabled}
        onClick={() => setOpen((o) => (o ? null : (buttonRef.current?.getBoundingClientRect() ?? null)))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(buttonRef.current?.getBoundingClientRect() ?? null);
          }
        }}
      >
        {children}
        {chevron && <Codicon name="chevron-down" size={14} className="dropdown-chevron" />}
      </button>
      {open && (
        <Menu
          entries={typeof entries === 'function' ? entries() : entries}
          x={open.left}
          y={open.bottom + 2}
          onClose={close}
          isInsideAnchor={isInsideAnchor}
        />
      )}
    </>
  );
}
