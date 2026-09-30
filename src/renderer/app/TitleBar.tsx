import { useCallback, useEffect, useRef, useState } from 'react';
import { Codicon } from '../components/Codicon';
import { Menu } from '../components/Menu';
import type { MenuCloseReason } from '../components/Menu';
import { commands } from '../commands/service';
import { es } from '../i18n/es';
import { useWorkspaceStore } from '../stores/workspace-store';
import { TITLE_BAR_MENUS } from './menus';

function MenuBar(): React.JSX.Element {
  const [openState, setOpenState] = useState<{ index: number; rect: DOMRect } | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const openIndex = useRef<number | null>(null);
  const open = openState?.index ?? null;

  /** Abre el menú `index` (o cierra con `null`), guardando la posición de su botón. */
  const setOpen = useCallback((index: number | null) => {
    openIndex.current = index;
    const rect = index !== null ? buttons.current[index]?.getBoundingClientRect() : undefined;
    setOpenState(index !== null && rect ? { index, rect } : null);
  }, []);

  const close = useCallback(
    (reason: MenuCloseReason) => {
      const current = openIndex.current;
      if (reason === 'escape' && current !== null) buttons.current[current]?.focus();
      setOpen(null);
    },
    [setOpen],
  );

  const isInsideAnchor = useCallback(
    (target: Element) => buttons.current.some((b) => b?.contains(target)),
    [],
  );

  const navigate = useCallback(
    (direction: 'left' | 'right') => {
      const current = openIndex.current;
      if (current === null) return;
      const n = TITLE_BAR_MENUS.length;
      setOpen((current + (direction === 'right' ? 1 : -1) + n) % n);
    },
    [setOpen],
  );

  const rect = openState?.rect;
  const menu = open !== null ? TITLE_BAR_MENUS[open] : undefined;

  return (
    <nav className="menubar" role="menubar" aria-label={es.app.name}>
      {TITLE_BAR_MENUS.map((m, index) => (
        <button
          key={m.id}
          ref={(el) => {
            buttons.current[index] = el;
          }}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={open === index}
          className={['menubar-item', open === index ? 'is-open' : ''].join(' ')}
          onMouseDown={(e) => {
            e.preventDefault();
            setOpen(open === index ? null : index);
          }}
          onMouseEnter={() => open !== null && open !== index && setOpen(index)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(index);
            }
          }}
        >
          {m.label}
        </button>
      ))}
      {menu && rect && (
        <Menu
          key={menu.id}
          entries={menu.entries()}
          x={rect.left}
          y={rect.bottom}
          onClose={close}
          onNavigate={navigate}
          isInsideAnchor={isInsideAnchor}
          ariaLabel={menu.label}
        />
      )}
    </nav>
  );
}

function WindowControls(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void window.api.app.getWindowState({}).then((r) => r.ok && setMaximized(r.data.maximized));
    return window.api.on('app:window-state', (s) => setMaximized(s.maximized));
  }, []);

  const control = (action: 'minimize' | 'toggle-maximize' | 'close'): void => {
    void window.api.app.windowControl({ action });
  };

  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-control"
        aria-label={es.titleBar.minimize}
        title={es.titleBar.minimize}
        onClick={() => control('minimize')}
      >
        <Codicon name="chrome-minimize" />
      </button>
      <button
        type="button"
        className="window-control"
        aria-label={maximized ? es.titleBar.restore : es.titleBar.maximize}
        title={maximized ? es.titleBar.restore : es.titleBar.maximize}
        onClick={() => control('toggle-maximize')}
      >
        <Codicon name={maximized ? 'chrome-restore' : 'chrome-maximize'} />
      </button>
      <button
        type="button"
        className="window-control is-close"
        aria-label={es.titleBar.close}
        title={es.titleBar.close}
        onClick={() => control('close')}
      >
        <Codicon name="chrome-close" />
      </button>
    </div>
  );
}

export function TitleBar(): React.JSX.Element {
  const workspaceName = useWorkspaceStore((s) => s.name);
  return (
    <header className="titlebar">
      <div className="titlebar-icon">
        <Codicon name="database" color="var(--accent)" />
      </div>
      <MenuBar />
      <button
        type="button"
        className="command-center"
        title={es.titleBar.commandCenterTooltip}
        onClick={() => void commands.execute('db.quickOpen')}
      >
        <Codicon name="search" size={14} />
        <span>{es.titleBar.commandCenter(workspaceName)}</span>
      </button>
      <WindowControls />
    </header>
  );
}
