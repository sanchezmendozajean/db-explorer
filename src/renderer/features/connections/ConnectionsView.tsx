import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectionConfig, Environment } from '@shared/connection';
import { connectionAddress } from '@shared/connection';
import type { TreeNodeData, TreeNodeRef } from '@shared/metadata';
import { nodeKey } from '@shared/metadata';
import { qualifiedName, quoteIdent } from '@shared/sql-quote';
import { Codicon } from '../../components/Codicon';
import { Button, IconButton } from '../../components/Button';
import { TextInput } from '../../components/Inputs';
import { Dropdown } from '../../components/Dropdown';
import type { TreeRow } from '../../components/VirtualTree';
import { VirtualTree } from '../../components/VirtualTree';
import type { MenuEntry } from '../../components/menu-types';
import { SEPARATOR } from '../../components/menu-types';
import { showContextMenu } from '../../components/ContextMenuHost';
import { es } from '../../i18n/es';
import { useConnectionsStore } from '../../stores/connections-store';
import { Highlight, SideBarHeader } from '../side-bar/SideBarHeader';
import * as actions from './actions';
import { newScript } from '../editor/scripts';
import { countRows, newDdlScript, newTableScript, objectRef, targetOfRef } from './table-scripts';
import { openObjectTab } from '../objects/object-tabs';
import { invalidateDetails } from '../objects/object-details';
import { dotStyle } from '../../components/env-dot';

const ENGINE_BADGE: Record<string, string> = { postgres: 'PG', mariadb: 'MY', sqlite: 'LT', sqlserver: 'MS' };
const ENVIRONMENTS: Environment[] = ['local', 'dev', 'qa', 'prod'];

type UiNode =
  | { type: 'folder'; id: string; name: string; children: UiNode[] }
  | { type: 'connection'; id: string; config: ConnectionConfig; children: UiNode[] }
  | { type: 'meta'; id: string; connectionId: string; data: TreeNodeData; children: UiNode[] };

type Row = TreeRow & { node: UiNode };

const folderId = (name: string): string => `folder:${encodeURIComponent(name)}`;
const connectionKey = (id: string): string => nodeKey(id, { kind: 'connection' });

function metaLabel(data: TreeNodeData): string {
  const f = es.connections.folders;
  switch (data.ref.kind) {
    case 'objectFolder':
      return f[data.ref.objectKind];
    case 'indexFolder':
      return f.indexes;
    case 'systemSchemas':
      return f.systemSchemas;
    default:
      return data.label;
  }
}

function metaSecondary(data: TreeNodeData): string | undefined {
  return data.count !== undefined ? `(${data.count})` : data.secondary;
}

function metaIcon(data: TreeNodeData): { name: string; color?: string } {
  const ref = data.ref;
  switch (ref.kind) {
    case 'database':
      return { name: 'database' };
    case 'schema':
      return { name: 'symbol-namespace' };
    case 'systemSchemas':
    case 'objectFolder':
    case 'indexFolder':
      return { name: 'folder' };
    case 'object':
      switch (ref.objectKind) {
        case 'table':
          return { name: 'table', color: 'var(--icon-table)' };
        case 'view':
        case 'materializedView':
          return { name: 'eye' };
        case 'function':
        case 'procedure':
          return { name: 'symbol-method' };
        case 'sequence':
          return { name: 'symbol-number' };
        default:
          return { name: 'symbol-misc' };
      }
    case 'column':
      return data.primaryKey ? { name: 'key', color: 'var(--warning)' } : { name: 'symbol-field' };
    case 'index':
      return data.primaryKey ? { name: 'key', color: 'var(--warning)' } : { name: 'list-tree' };
    default:
      return { name: 'circle-outline' };
  }
}

function nodeLabel(node: UiNode): string {
  if (node.type === 'folder') return node.name;
  if (node.type === 'connection') return node.config.name;
  return metaLabel(node.data);
}

/**
 * Filtra solo los objetos (tablas, vistas, rutinas, secuencias…) por nombre.
 * Carpetas y conexiones siempre se muestran; bases, esquemas y carpetas de
 * objetos quedan si tienen coincidencias o si aún no se cargaron. Los
 * ancestros de una coincidencia quedan expandidos; el objeto conserva sus hijos.
 */
function filterNodes(
  nodes: UiNode[],
  query: string,
  forced: Set<string>,
  isLoaded: (id: string) => boolean,
): UiNode[] {
  const q = query.toLowerCase();
  const out: UiNode[] = [];
  for (const node of nodes) {
    if (node.type === 'meta' && node.data.ref.kind === 'object') {
      if (nodeLabel(node).toLowerCase().includes(q)) out.push(node);
      continue;
    }
    const children = filterNodes(node.children, query, forced, isLoaded);
    if (children.length > 0) {
      forced.add(node.id);
      out.push({ ...node, children });
    } else if (node.type !== 'meta' || !isLoaded(node.id)) {
      out.push({ ...node, children: [] });
    }
  }
  return out;
}

const HAS_DATA = ['table', 'view', 'materializedView'];

function isDataObject(ref: TreeNodeRef): ref is Extract<TreeNodeRef, { kind: 'object' }> {
  return ref.kind === 'object' && HAS_DATA.includes(ref.objectKind);
}

export function ConnectionsView(): React.JSX.Element {
  const {
    loaded,
    folders,
    connections,
    status,
    children,
    loading,
    nodeErrors,
    loadChildren,
    expandOnConnect,
  } = useConnectionsStore();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [envFilter, setEnvFilter] = useState<Set<Environment>>(() => new Set(ENVIRONMENTS));
  const filterRef = useRef<HTMLInputElement>(null);

  const tree = useMemo(() => {
    const metaChildren = (connectionId: string, key: string): UiNode[] =>
      (children[key] ?? []).map((data) => {
        const id = nodeKey(connectionId, data.ref);
        return { type: 'meta', id, connectionId, data, children: metaChildren(connectionId, id) };
      });
    const connectionNode = (config: ConnectionConfig): UiNode => {
      const id = connectionKey(config.id);
      return { type: 'connection', id, config, children: metaChildren(config.id, id) };
    };
    const visible = connections.filter((c) => envFilter.has(c.environment));
    const folderNodes: UiNode[] = folders.map((name) => ({
      type: 'folder',
      id: folderId(name),
      name,
      children: visible.filter((c) => c.folder === name).map(connectionNode),
    }));
    const rootNodes = visible.filter((c) => !c.folder || !folders.includes(c.folder)).map(connectionNode);
    return [...folderNodes, ...rootNodes];
  }, [connections, folders, children, envFilter]);

  const rows = useMemo(() => {
    const forced = new Set<string>();
    const nodes = query ? filterNodes(tree, query, forced, (id) => id in children) : tree;
    const out: Row[] = [];
    const walk = (list: UiNode[], depth: number): void => {
      for (const node of list) {
        const expandable = node.type !== 'meta' || node.data.expandable;
        // Una conexión cerrada nunca se muestra expandida.
        const closed = node.type === 'connection' && status[node.config.id]?.state !== 'connected';
        const isExpanded = expandable && !closed && (expanded.has(node.id) || forced.has(node.id));
        const isLoading =
          !!loading[node.id] ||
          (node.type === 'connection' && status[node.config.id]?.state === 'connecting');
        out.push({ id: node.id, depth, expandable, expanded: isExpanded, loading: isLoading, node });
        if (isExpanded) walk(node.children, depth + 1);
      }
    };
    walk(nodes, 0);
    return out;
  }, [tree, query, expanded, loading, status, children]);

  // Carga perezosa: todo nodo expandido de una conexión abierta carga sus hijos si aún no los tiene.
  useEffect(() => {
    for (const row of rows) {
      if (!row.expanded || row.node.type === 'folder') continue;
      const connectionId = row.node.type === 'connection' ? row.node.config.id : row.node.connectionId;
      if (status[connectionId]?.state !== 'connected') continue;
      if (children[row.id] || loading[row.id] || nodeErrors[row.id]) continue;
      const ref: TreeNodeRef = row.node.type === 'connection' ? { kind: 'connection' } : row.node.data.ref;
      void loadChildren(connectionId, ref);
    }
  }, [rows, status, children, loading, nodeErrors, loadChildren]);

  // Tras conectar desde el diálogo de contraseña, se completa la expansión pedida.
  useEffect(() => {
    if (!expandOnConnect || status[expandOnConnect]?.state !== 'connected') return;
    const key = connectionKey(expandOnConnect);
    useConnectionsStore.setState({ expandOnConnect: null });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- responde a un cambio externo del store
    setExpanded((prev) => new Set(prev).add(key));
  }, [expandOnConnect, status]);

  // Mostrar un nodo pedido desde fuera (F12, Ctrl+P): se expande su ruta y se selecciona.
  const revealRequest = useConnectionsStore((s) => s.revealRequest);
  useEffect(() => {
    if (!revealRequest) return;
    const { keys } = revealRequest;
    useConnectionsStore.setState({ revealRequest: null });
    /* eslint-disable react-hooks/set-state-in-effect -- responde a un pedido externo del store */
    setExpanded((prev) => new Set([...prev, ...keys.slice(0, -1)]));
    setSelected(keys[keys.length - 1] ?? null);
    /* eslint-enable react-hooks/set-state-in-effect */
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[data-view="connections"] .tree')?.focus(),
    );
  }, [revealRequest]);

  const setOpen = (id: string, open: boolean): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Expandir una conexión cerrada la conecta primero (pidiendo la contraseña si hace falta). */
  const toggleNode = async (node: UiNode, open: boolean): Promise<void> => {
    if (node.type === 'connection' && open && status[node.config.id]?.state !== 'connected') {
      if (!(await actions.connect(node.config.id))) return;
    }
    setOpen(node.id, open);
  };

  const refresh = (node: UiNode): void => {
    // La estructura cacheada (clave para editar, pestaña Estructura) se vuelve a leer.
    if (node.type !== 'folder')
      invalidateDetails(node.type === 'connection' ? node.config.id : node.connectionId);
    if (node.type === 'connection') {
      if (status[node.config.id]?.state === 'connected')
        void loadChildren(node.config.id, { kind: 'connection' }, true);
    } else if (node.type === 'meta') {
      void loadChildren(node.connectionId, node.data.ref, true);
    }
  };

  const refreshSelectedOrAll = (): void => {
    const row = rows.find((r) => r.id === selected);
    if (row && row.node.type !== 'folder') {
      refresh(row.node);
      return;
    }
    for (const c of connections) {
      if (status[c.id]?.state === 'connected') void loadChildren(c.id, { kind: 'connection' }, true);
    }
  };

  const contextEntries = (node: UiNode): MenuEntry[] => {
    const t = es.tree;
    const c = es.connections;
    if (node.type === 'folder') {
      return [
        { type: 'item', id: 'new', label: c.newConnectionHere, run: () => actions.newConnection(node.name) },
        SEPARATOR,
        {
          type: 'item',
          id: 'rename',
          label: t.rename,
          keybinding: 'F2',
          run: () => actions.renameFolder(node.name),
        },
        {
          type: 'item',
          id: 'delete',
          label: t.delete,
          keybinding: 'Supr',
          run: () => actions.deleteFolder(node.name),
        },
      ];
    }
    if (node.type === 'connection') {
      const cfg = node.config;
      const connected = status[cfg.id]?.state === 'connected';
      return [
        connected
          ? {
              type: 'item',
              id: 'disconnect',
              label: t.disconnect,
              run: () => void actions.disconnect(cfg.id),
            }
          : { type: 'item', id: 'connect', label: t.connect, run: () => void toggleNode(node, true) },
        {
          type: 'item',
          id: 'script',
          label: t.newScript,
          keybinding: 'Ctrl+]',
          run: () => void newScript({ connectionId: cfg.id }),
        },
        SEPARATOR,
        {
          type: 'item',
          id: 'edit',
          label: t.editConnection,
          keybinding: 'F4',
          run: () => actions.editConnection(cfg.id),
        },
        {
          type: 'item',
          id: 'duplicate',
          label: t.duplicate,
          run: () => void actions.duplicateConnection(cfg.id),
        },
        {
          type: 'item',
          id: 'rename',
          label: t.rename,
          keybinding: 'F2',
          run: () => actions.renameConnection(cfg.id),
        },
        {
          type: 'submenu',
          id: 'move',
          label: t.moveToFolder,
          entries: [
            {
              type: 'item',
              id: 'root',
              label: t.rootFolder,
              checked: !cfg.folder,
              run: () => void actions.moveToFolder(cfg.id, undefined),
            },
            ...folders.map((f): MenuEntry => ({
              type: 'item',
              id: `f-${f}`,
              label: f,
              checked: cfg.folder === f,
              run: () => void actions.moveToFolder(cfg.id, f),
            })),
            SEPARATOR,
            {
              type: 'item',
              id: 'new-folder',
              label: c.newFolderInside,
              run: () => actions.newFolder(cfg.id),
            },
          ],
        },
        {
          type: 'item',
          id: 'delete',
          label: t.delete,
          keybinding: 'Supr',
          run: () => actions.deleteConnection(cfg.id),
        },
        SEPARATOR,
        {
          type: 'item',
          id: 'refresh',
          label: t.refresh,
          keybinding: 'F5',
          disabled: !connected,
          run: () => refresh(node),
        },
        { type: 'item', id: 'copy', label: t.copyName, run: () => actions.copyText(cfg.name) },
      ];
    }
    const ref = node.data.ref;
    const copyName: MenuEntry = {
      type: 'item',
      id: 'copy',
      label: t.copyName,
      run: () => actions.copyText(node.data.label),
    };
    const refreshEntry: MenuEntry = {
      type: 'item',
      id: 'refresh',
      label: t.refresh,
      keybinding: 'F5',
      run: () => refresh(node),
    };
    if (ref.kind === 'object' && HAS_DATA.includes(ref.objectKind)) {
      const engine = connections.find((x) => x.id === node.connectionId)?.engine ?? 'postgres';
      const isTable = ref.objectKind === 'table';
      const script = (id: 'select' | 'insert' | 'update' | 'delete', label: string): MenuEntry => ({
        type: 'item',
        id,
        label,
        disabled: id !== 'select' && !isTable,
        run: () => void newTableScript(node.connectionId, ref, id),
      });
      return [
        {
          type: 'item',
          id: 'data',
          label: t.viewData,
          run: () => openObjectTab(node.connectionId, objectRef(ref), 'data'),
        },
        {
          type: 'item',
          id: 'structure',
          label: t.viewStructure,
          run: () => openObjectTab(node.connectionId, objectRef(ref), 'structure'),
        },
        {
          type: 'submenu',
          id: 'script',
          label: t.newScriptOf,
          entries: [
            script('select', t.scriptSelect),
            script('insert', t.scriptInsert),
            script('update', t.scriptUpdate),
            script('delete', t.scriptDelete),
            {
              type: 'item',
              id: 'ddl',
              label: t.scriptDdl,
              run: () => void newDdlScript(node.connectionId, ref),
            },
          ],
        },
        SEPARATOR,
        copyName,
        {
          type: 'item',
          id: 'copyq',
          label: t.copyQualifiedName,
          run: () => actions.copyText(qualifiedName(engine, { schema: ref.schema, name: ref.name })),
        },
        SEPARATOR,
        refreshEntry,
        { type: 'item', id: 'count', label: t.countRows, run: () => void countRows(node.connectionId, ref) },
      ];
    }
    return [refreshEntry, copyName];
  };

  const onRowKeyDown = (e: React.KeyboardEvent, row: Row): boolean => {
    const node = row.node;
    if (e.ctrlKey && e.key === ']' && node.type !== 'folder') {
      const connectionId = node.type === 'connection' ? node.config.id : node.connectionId;
      void newScript(targetOfRef(connectionId, node.type === 'meta' ? node.data.ref : null));
      return true;
    }
    if (e.ctrlKey && e.key === 'Enter' && node.type === 'meta' && isDataObject(node.data.ref)) {
      void newTableScript(node.connectionId, node.data.ref, 'select');
      return true;
    }
    switch (e.key) {
      case 'F2':
        if (node.type === 'folder') actions.renameFolder(node.name);
        else if (node.type === 'connection') actions.renameConnection(node.config.id);
        else return false;
        return true;
      case 'Delete':
        if (node.type === 'folder') actions.deleteFolder(node.name);
        else if (node.type === 'connection') actions.deleteConnection(node.config.id);
        else return false;
        return true;
      case 'F4':
        if (node.type !== 'connection') return false;
        actions.editConnection(node.config.id);
        return true;
      case 'F5':
        refresh(node);
        return true;
      default:
        return false;
    }
  };

  const parseDrag = (data: string): actions.DropTarget | null => {
    try {
      return JSON.parse(data) as actions.DropTarget;
    } catch {
      return null;
    }
  };

  const dragData = (row: Row): string | null => {
    if (query) return null;
    if (row.node.type === 'folder') return JSON.stringify({ type: 'folder', name: row.node.name });
    if (row.node.type === 'connection') return JSON.stringify({ type: 'connection', id: row.node.config.id });
    return null;
  };

  /** Texto al arrastrar tablas o columnas al editor: nombre calificado y entrecomillado (specs/04 §6). */
  const dragText = (row: Row): string | null => {
    if (row.node.type !== 'meta') return null;
    const ref = row.node.data.ref;
    const engine =
      connections.find((x) => x.id === (row.node as { connectionId: string }).connectionId)?.engine ??
      'postgres';
    if (ref.kind === 'object') return qualifiedName(engine, { schema: ref.schema, name: ref.name });
    if (ref.kind === 'column') return quoteIdent(engine, ref.name);
    return null;
  };

  const canDrop = (data: string, target: Row): boolean => {
    const dragged = parseDrag(data);
    if (!dragged) return false;
    if (dragged.type === 'folder') return target.node.type === 'folder' && target.node.name !== dragged.name;
    return (
      target.node.type === 'folder' ||
      (target.node.type === 'connection' && target.node.config.id !== dragged.id)
    );
  };

  const onDrop = (data: string, target: Row): void => {
    const dragged = parseDrag(data);
    if (!dragged) return;
    if (target.node.type === 'folder')
      void actions.dropOnto(dragged, { type: 'folder', name: target.node.name });
    else if (target.node.type === 'connection')
      void actions.dropOnto(dragged, { type: 'connection', id: target.node.config.id });
  };

  const envEntries = (): MenuEntry[] => [
    ...ENVIRONMENTS.map((env): MenuEntry => ({
      type: 'item',
      id: env,
      label: es.environments[env],
      checked: envFilter.has(env),
      run: () =>
        setEnvFilter((prev) => {
          const next = new Set(prev);
          if (next.has(env)) next.delete(env);
          else next.add(env);
          return next;
        }),
    })),
    SEPARATOR,
    {
      type: 'item',
      id: 'all',
      label: es.connections.envFilterAll,
      run: () => setEnvFilter(new Set(ENVIRONMENTS)),
    },
  ];

  const headerActions = (
    <>
      <IconButton icon="add" label={es.sideBar.newConnection} onClick={() => actions.newConnection()} />
      <IconButton icon="new-folder" label={es.sideBar.newFolder} onClick={() => actions.newFolder()} />
      <IconButton icon="refresh" label={es.sideBar.refresh} onClick={refreshSelectedOrAll} />
      <IconButton icon="collapse-all" label={es.sideBar.collapseAll} onClick={() => setExpanded(new Set())} />
      <Dropdown
        className="icon-btn"
        chevron={false}
        title={es.sideBar.more}
        entries={() => [
          { type: 'submenu', id: 'env', label: es.sideBar.filterByEnvironment, entries: envEntries() },
        ]}
      >
        <Codicon name="ellipsis" />
      </Dropdown>
    </>
  );

  const renderRow = (row: Row): React.JSX.Element => {
    const node = row.node;
    if (node.type === 'folder') {
      return (
        <>
          <Codicon name="folder" className="tree-icon" />
          <span className="tree-label">
            <Highlight text={node.name} query={query} />
          </span>
        </>
      );
    }
    if (node.type === 'connection') {
      const cfg = node.config;
      const st = status[cfg.id];
      const error = st?.state === 'error' ? st.message : nodeErrors[node.id];
      return (
        <>
          <span
            className={st?.state === 'connected' ? 'env-dot' : 'env-dot is-hollow'}
            style={dotStyle(cfg.color ?? `var(--env-${cfg.environment})`)}
            data-testid="connection-dot"
          />
          <span className={['engine-badge', st?.state === 'connected' ? '' : 'is-disconnected'].join(' ')}>
            {ENGINE_BADGE[cfg.engine]}
          </span>
          <span className="tree-label">
            <Highlight text={cfg.name} query={query} />
          </span>
          <span className="tree-secondary">{connectionAddress(cfg)}</span>
          {error && (
            <span className="tree-error" title={es.connections.status.error(error)} data-testid="tree-error">
              <Codicon name="error" color="var(--error)" size={14} />
            </span>
          )}
        </>
      );
    }
    const icon = metaIcon(node.data);
    const secondary = metaSecondary(node.data);
    const error = nodeErrors[node.id];
    return (
      <>
        <Codicon name={icon.name} color={icon.color} className="tree-icon" />
        <span className="tree-label">
          <Highlight text={metaLabel(node.data)} query={query} />
        </span>
        {secondary && <span className="tree-secondary">{secondary}</span>}
        {error && (
          <span className="tree-error" title={es.connections.loadFailed(error)} data-testid="tree-error">
            <Codicon name="error" color="var(--error)" size={14} />
          </span>
        )}
      </>
    );
  };

  return (
    <div className="sidebar-view" data-view="connections">
      <SideBarHeader title={es.sideBar.connectionsTitle} actions={headerActions} />
      {loaded && connections.length === 0 && folders.length === 0 ? (
        <div className="empty-state">
          <Codicon name="database" size={48} color="var(--fg-muted)" />
          <p>{es.sideBar.noConnections}</p>
          <Button icon="add" onClick={() => actions.newConnection()}>
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
              onSelect={(id) => {
                setSelected(id);
                const row = rows.find((r) => r.id === id);
                const node = row?.node;
                useConnectionsStore.setState({
                  treeSelection:
                    !node || node.type === 'folder'
                      ? null
                      : targetOfRef(
                          node.type === 'connection' ? node.config.id : node.connectionId,
                          node.type === 'meta' ? node.data.ref : null,
                        ),
                });
              }}
              onToggle={(id, open) => {
                const row = rows.find((r) => r.id === id);
                if (row) void toggleNode(row.node, open);
              }}
              toggleOnClick={false}
              basePadding={6}
              onOpen={(row) => {
                // Doble clic o Enter en una tabla o vista: pestaña de objeto en Datos (specs/04 §6).
                if (row.node.type === 'meta' && isDataObject(row.node.data.ref)) {
                  openObjectTab(row.node.connectionId, objectRef(row.node.data.ref), 'data');
                } else if (row.expandable) void toggleNode(row.node, !row.expanded);
              }}
              onRowKeyDown={onRowKeyDown}
              onContextMenu={(row, e) => showContextMenu(e, contextEntries(row.node))}
              dragData={dragData}
              dragText={dragText}
              onMiddleClick={(row) => {
                if (row.node.type === 'meta' && isDataObject(row.node.data.ref))
                  void newTableScript(row.node.connectionId, row.node.data.ref, 'select');
              }}
              canDrop={canDrop}
              onDrop={onDrop}
              renderRow={renderRow}
            />
          )}
        </>
      )}
    </div>
  );
}
