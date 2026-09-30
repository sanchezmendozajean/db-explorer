import { useMemo, useRef, useState } from 'react';
import { Codicon } from '../../components/Codicon';
import { Button, IconButton } from '../../components/Button';
import { TextInput } from '../../components/Inputs';
import { Dropdown } from '../../components/Dropdown';
import { VirtualTree, flattenTree } from '../../components/VirtualTree';
import type { MenuEntry } from '../../components/menu-types';
import { SEPARATOR } from '../../components/menu-types';
import { showContextMenu } from '../../components/ContextMenuHost';
import { es } from '../../i18n/es';
import { notAvailable } from '../../app/app-commands';
import type { SampleTreeNode } from '../../sample/sample-data';
import { SAMPLE_CONNECTION_TREE, SAMPLE_EXPANDED, sampleConnection } from '../../sample/sample-data';
import { useSampleStore } from '../../stores/sample-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import { showToast } from '../../stores/toast-store';
import { Highlight, SideBarHeader } from '../side-bar/SideBarHeader';

const ENGINE_BADGE: Record<string, string> = { postgres: 'PG', mariadb: 'MY', sqlite: 'LT', sqlserver: 'MS' };

const KIND_ICON: Partial<Record<SampleTreeNode['kind'], string>> = {
  database: 'database',
  schema: 'symbol-namespace',
  folder: 'folder',
  table: 'table',
  view: 'eye',
  function: 'symbol-method',
  sequence: 'symbol-number',
};

/** Filtra conservando ancestros de las coincidencias. */
function filterTree(nodes: SampleTreeNode[], query: string, expandOut: Set<string>): SampleTreeNode[] {
  const q = query.toLowerCase();
  const out: SampleTreeNode[] = [];
  for (const node of nodes) {
    const children = node.children ? filterTree(node.children, query, expandOut) : undefined;
    const matches = node.label.toLowerCase().includes(q);
    if (children && children.length > 0) {
      expandOut.add(node.id);
      out.push({ ...node, children });
    } else if (matches) {
      out.push(node.children ? { ...node, children: [] } : node);
    }
  }
  return out;
}

function copyText(text: string): void {
  void window.api.app.clipboardWrite({ text }).then((r) => r.ok && showToast('info', es.toasts.copied));
}

function contextEntries(node: SampleTreeNode): MenuEntry[] {
  const pending = (label: string, id = label): MenuEntry => ({
    type: 'item',
    id,
    label,
    run: () => notAvailable(label),
  });
  if (node.kind === 'connection') {
    return [
      pending(es.tree.connect),
      pending(es.tree.newScript),
      SEPARATOR,
      pending(es.tree.editConnection),
      pending(es.tree.duplicate),
      pending(es.tree.rename),
      {
        type: 'submenu',
        id: 'move',
        label: es.tree.moveToFolder,
        entries: [pending(es.tree.rootFolder)],
      },
      pending(es.tree.delete),
      SEPARATOR,
      pending(es.tree.refresh),
      { type: 'item', id: 'copy', label: es.tree.copyName, run: () => copyText(node.label) },
    ];
  }
  if (node.kind === 'table' || node.kind === 'view') {
    return [
      { type: 'item', id: 'data', label: es.tree.viewData, run: () => openObject(node) },
      pending(es.tree.viewStructure),
      {
        type: 'submenu',
        id: 'script',
        label: es.tree.newScriptOf,
        entries: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DDL'].map((s) => pending(s)),
      },
      SEPARATOR,
      { type: 'item', id: 'copy', label: es.tree.copyName, run: () => copyText(node.label) },
      {
        type: 'item',
        id: 'copyq',
        label: es.tree.copyQualifiedName,
        run: () => copyText(`public."${node.label}"`),
      },
      SEPARATOR,
      { ...(pending(es.tree.refresh) as Extract<MenuEntry, { type: 'item' }>), keybinding: 'F5' },
      pending(es.tree.countRows),
    ];
  }
  return [
    pending(es.tree.refresh),
    { type: 'item', id: 'copy', label: es.tree.copyName, run: () => copyText(node.label) },
  ];
}

function openObject(node: SampleTreeNode): void {
  const connectionId = node.id.startsWith('pb/')
    ? 'paybox-prod'
    : node.id.startsWith('sga/')
      ? 'sga-test'
      : node.id.startsWith('req/')
        ? 'requerimientos'
        : 'local';
  const conn = sampleConnection(connectionId);
  useWorkbenchStore.getState().open({
    id: `object:${node.id}`,
    kind: 'object',
    title: node.label,
    tooltip: [conn?.name, conn?.database, conn?.schema, node.label].filter(Boolean).join(' › '),
    connectionId,
    dirty: false,
    preview: true,
  });
}

export function ConnectionsView(): React.JSX.Element {
  const sampleEnabled = useSampleStore((s) => s.enabled);
  const nodes = useMemo(() => (sampleEnabled ? SAMPLE_CONNECTION_TREE : []), [sampleEnabled]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(SAMPLE_EXPANDED));
  const [selected, setSelected] = useState<string | null>(
    'pb/paybox/public/tables/CRendiciones_Conf_Generales',
  );
  const [query, setQuery] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => {
    if (!query) return flattenTree(nodes, expanded);
    const forced = new Set<string>();
    const filtered = filterTree(nodes, query, forced);
    return flattenTree(filtered, new Set([...expanded, ...forced]));
  }, [nodes, expanded, query]);

  const toggle = (id: string, open: boolean): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  const actions = (
    <>
      <IconButton
        icon="add"
        label={es.sideBar.newConnection}
        onClick={() => notAvailable(es.sideBar.newConnection)}
      />
      <IconButton
        icon="new-folder"
        label={es.sideBar.newFolder}
        onClick={() => notAvailable(es.sideBar.newFolder)}
      />
      <IconButton
        icon="refresh"
        label={es.sideBar.refresh}
        onClick={() => notAvailable(es.sideBar.refresh)}
      />
      <IconButton icon="collapse-all" label={es.sideBar.collapseAll} onClick={() => setExpanded(new Set())} />
      <Dropdown
        className="icon-btn"
        chevron={false}
        title={es.sideBar.more}
        entries={[
          {
            type: 'item',
            id: 'env',
            label: es.sideBar.filterByEnvironment,
            disabled: true,
            run: () => undefined,
          },
          {
            type: 'item',
            id: 'sys',
            label: es.sideBar.showSystemObjects,
            disabled: true,
            run: () => undefined,
          },
        ]}
      >
        <Codicon name="ellipsis" />
      </Dropdown>
    </>
  );

  return (
    <div className="sidebar-view" data-view="connections">
      <SideBarHeader title={es.sideBar.connectionsTitle} actions={actions} />
      {nodes.length === 0 ? (
        <div className="empty-state">
          <Codicon name="database" size={48} color="var(--fg-muted)" />
          <p>{es.sideBar.noConnections}</p>
          <Button icon="add" onClick={() => notAvailable(es.sideBar.newConnection)}>
            {es.sideBar.newConnection}
          </Button>
        </div>
      ) : (
        <>
          <div className="sidebar-filter">
            <TextInput
              ref={filterRef}
              icon="filter"
              placeholder={es.sideBar.filterPlaceholder}
              aria-label={es.sideBar.filterPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('');
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  filterRef.current?.closest('.sidebar-view')?.querySelector<HTMLElement>('.tree')?.focus();
                }
              }}
            />
          </div>
          {rows.length === 0 ? (
            <p className="sidebar-message">{es.sideBar.noMatches}</p>
          ) : (
            <VirtualTree
              rows={rows}
              ariaLabel={es.sideBar.connectionsTitle}
              selectedId={selected}
              onSelect={setSelected}
              onToggle={toggle}
              indent={10}
              basePadding={6}
              onOpen={(row) => {
                if (row.node.kind === 'table' || row.node.kind === 'view') openObject(row.node);
                else if (row.expandable) toggle(row.id, !row.expanded);
              }}
              onContextMenu={(row, e) => showContextMenu(e, contextEntries(row.node))}
              renderRow={(row) => {
                const n = row.node;
                if (n.kind === 'connection') {
                  const conn = sampleConnection(n.connectionId);
                  return (
                    <>
                      <span
                        className="env-dot"
                        style={{ background: `var(--env-${conn?.environment ?? 'local'})` }}
                      />
                      <span className="engine-badge">{ENGINE_BADGE[conn?.engine ?? 'postgres']}</span>
                      <span className="tree-label">
                        <Highlight text={n.label} query={query} />
                      </span>
                      {n.secondary && <span className="tree-secondary">{n.secondary}</span>}
                    </>
                  );
                }
                return (
                  <>
                    <Codicon
                      name={KIND_ICON[n.kind] ?? 'circle-outline'}
                      color={n.kind === 'table' ? 'var(--icon-table)' : undefined}
                      className="tree-icon"
                    />
                    <span className="tree-label">
                      <Highlight text={n.label} query={query} />
                    </span>
                    {n.secondary && <span className="tree-secondary">{n.secondary}</span>}
                  </>
                );
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
