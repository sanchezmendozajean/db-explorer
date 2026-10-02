import { useRef, useState } from 'react';
import type { SideBarView } from '@shared/ui-state';
import { Codicon } from '../components/Codicon';
import { Menu } from '../components/Menu';
import { SEPARATOR } from '../components/menu-types';
import { es } from '../i18n/es';
import { useUiStore } from '../stores/ui-store';
import { commandEntry, themeEntries } from './menus';

const VIEWS: { view: SideBarView; icon: string; label: string }[] = [
  { view: 'connections', icon: 'database', label: es.activityBar.connections },
  { view: 'files', icon: 'files', label: es.activityBar.files },
  { view: 'history', icon: 'history', label: es.activityBar.history },
];

export function ActivityBar(): React.JSX.Element {
  const sideBar = useUiStore((s) => s.sideBar);
  const showView = useUiStore((s) => s.showView);
  const gearRef = useRef<HTMLButtonElement>(null);
  const [gearMenu, setGearMenu] = useState<DOMRect | null>(null);

  return (
    <nav className="activitybar" aria-label={es.activityBar.manage}>
      <div className="activitybar-top" role="tablist" aria-orientation="vertical">
        {VIEWS.map(({ view, icon, label }) => {
          const active = sideBar.visible && sideBar.view === view;
          return (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={active}
              className={['activitybar-item', active ? 'is-active' : ''].join(' ')}
              title={label}
              aria-label={label}
              data-view-button={view}
              onClick={() => showView(view, true)}
            >
              <Codicon name={icon} size={24} />
            </button>
          );
        })}
      </div>
      <button
        ref={gearRef}
        type="button"
        className="activitybar-item"
        title={es.activityBar.manage}
        aria-label={es.activityBar.manage}
        aria-haspopup="menu"
        onClick={() => setGearMenu(gearRef.current?.getBoundingClientRect() ?? null)}
      >
        <Codicon name="settings-gear" size={24} />
      </button>
      {gearMenu && (
        <Menu
          entries={[
            commandEntry('db.preferences'),
            commandEntry('db.preferences.openJson'),
            commandEntry('db.help.keybindings'),
            commandEntry('db.keybindings.open'),
            SEPARATOR,
            { type: 'submenu', id: 'theme', label: es.menu.theme, entries: themeEntries() },
          ]}
          x={gearMenu.right + 2}
          y={gearMenu.top}
          onClose={() => setGearMenu(null)}
          isInsideAnchor={(t) => !!gearRef.current?.contains(t)}
        />
      )}
    </nav>
  );
}
