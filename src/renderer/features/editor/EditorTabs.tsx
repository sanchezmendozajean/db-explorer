import type { CSSProperties } from 'react';
import { useRef, useState } from 'react';
import { Codicon } from '../../components/Codicon';
import { IconButton } from '../../components/Button';
import { Dropdown } from '../../components/Dropdown';
import { showContextMenu } from '../../components/ContextMenuHost';
import type { MenuEntry } from '../../components/menu-types';
import { SEPARATOR } from '../../components/menu-types';
import { keybindingLabel } from '../../commands/service';
import { es } from '../../i18n/es';
import { notAvailable } from '../../app/app-commands';
import { commands } from '../../commands/service';
import { useConnectionsStore } from '../../stores/connections-store';
import { showToast } from '../../stores/toast-store';
import { closeTabs } from './scripts';
import type { EditorTab } from '../../stores/workbench-store';
import { useWorkbenchStore } from '../../stores/workbench-store';

const TAB_ICON: Record<EditorTab['kind'], { icon: string; color: string }> = {
  script: { icon: 'file-code', color: 'var(--fg-muted)' },
  object: { icon: 'table', color: 'var(--icon-table)' },
};

function tabMenu(tab: EditorTab): MenuEntry[] {
  const tabs = useWorkbenchStore.getState().tabs;
  const t = es.editor.tabs;
  const ids = (list: EditorTab[]): string[] => list.map((x) => x.id);
  const index = tabs.findIndex((x) => x.id === tab.id);
  return [
    {
      type: 'item',
      id: 'close',
      label: t.close,
      keybinding: keybindingLabel('db.closeTab'),
      run: () => void closeTabs([tab.id]),
    },
    {
      type: 'item',
      id: 'others',
      label: t.closeOthers,
      run: () => void closeTabs(ids(tabs.filter((x) => x.id !== tab.id))),
    },
    {
      type: 'item',
      id: 'right',
      label: t.closeToRight,
      run: () => void closeTabs(ids(tabs.slice(index + 1))),
    },
    {
      type: 'item',
      id: 'saved',
      label: t.closeSaved,
      run: () => void closeTabs(ids(tabs.filter((x) => !x.dirty))),
    },
    { type: 'item', id: 'all', label: t.closeAll, run: () => void closeTabs(ids(tabs)) },
    SEPARATOR,
    {
      type: 'item',
      id: 'path',
      label: t.copyPath,
      disabled: !tab.path,
      run: () =>
        void window.api.app
          .clipboardWrite({ text: tab.path ?? '' })
          .then((r) => r.ok && showToast('info', es.toasts.copied)),
    },
    {
      type: 'item',
      id: 'reveal',
      label: t.revealInFiles,
      disabled: !tab.path,
      run: () => {
        useWorkbenchStore.getState().activate(tab.id);
        void commands.execute('db.files.revealActive');
      },
    },
  ];
}

export function EditorTabs(): React.JSX.Element {
  const tabs = useWorkbenchStore((s) => s.tabs);
  const activeId = useWorkbenchStore((s) => s.activeId);
  const { activate, pin, move } = useWorkbenchStore.getState();
  const connections = useConnectionsStore((s) => s.connections);
  const close = (id: string): void => void closeTabs([id]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  return (
    <div className="editor-tabs">
      <div
        ref={scrollRef}
        className="editor-tabs-scroll"
        role="tablist"
        aria-label={es.editor.tabs.showOpenTabs}
        onWheel={(e) => {
          if (scrollRef.current && e.deltaY !== 0) scrollRef.current.scrollLeft += e.deltaY;
        }}
      >
        {tabs.map((tab, index) => {
          const active = tab.id === activeId;
          const conn = connections.find((c) => c.id === tab.connectionId);
          const env = conn ? (conn.color ?? `var(--env-${conn.environment})`) : undefined;
          // Los archivos de texto que no son SQL usan el ícono de archivo genérico.
          const icon =
            tab.kind === 'script' && tab.path && !/\.sql$/i.test(tab.path)
              ? { icon: 'file', color: 'var(--fg-muted)' }
              : TAB_ICON[tab.kind];
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={tab.tooltip}
              data-testid="editor-tab"
              draggable
              className={[
                'editor-tab',
                active ? 'is-active' : '',
                tab.preview ? 'is-preview' : '',
                tab.dirty ? 'is-dirty' : '',
                dragOver === tab.id ? 'is-drop-target' : '',
                env ? 'has-env' : '',
              ].join(' ')}
              style={env ? ({ '--tab-env': env } as CSSProperties) : undefined}
              onMouseDown={(e) => {
                if (e.button === 0) activate(tab.id);
                if (e.button === 1) e.preventDefault();
              }}
              onAuxClick={(e) => e.button === 1 && close(tab.id)}
              onDoubleClick={() => pin(tab.id)}
              onContextMenu={(e) => showContextMenu(e, tabMenu(tab))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') activate(tab.id);
              }}
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-db-tab', tab.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/x-db-tab')) {
                  e.preventDefault();
                  setDragOver(tab.id);
                }
              }}
              onDragLeave={() => setDragOver((d) => (d === tab.id ? null : d))}
              onDrop={(e) => {
                const id = e.dataTransfer.getData('application/x-db-tab');
                setDragOver(null);
                if (id) move(id, index);
              }}
            >
              <Codicon name={icon.icon} color={icon.color} size={16} />
              <span className="editor-tab-label">{tab.title}</span>
              <button
                type="button"
                className="editor-tab-close"
                tabIndex={-1}
                aria-label={es.editor.tabs.close}
                title={tab.dirty ? es.editor.tabs.unsaved : es.editor.tabs.close}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => close(tab.id)}
              >
                <Codicon name="close" className="icon-close" />
                <Codicon name="circle-filled" size={10} className="icon-dirty" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="editor-tabs-actions">
        <IconButton
          icon="split-horizontal"
          label={es.editor.tabs.splitEditor}
          onClick={() => notAvailable(es.editor.tabs.splitEditor)}
        />
        <Dropdown
          className="icon-btn"
          chevron={false}
          title={es.editor.tabs.showOpenTabs}
          disabled={tabs.length === 0}
          entries={() =>
            tabs.map((t) => ({
              type: 'item' as const,
              id: t.id,
              label: t.title,
              checked: t.id === activeId,
              run: () => activate(t.id),
            }))
          }
        >
          <Codicon name="ellipsis" />
        </Dropdown>
      </div>
    </div>
  );
}
