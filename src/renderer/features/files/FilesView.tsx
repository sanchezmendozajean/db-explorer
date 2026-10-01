import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileNode } from '@shared/workspace';
import { invalidFileName } from '@shared/workspace';
import { Codicon } from '../../components/Codicon';
import { Button, IconButton } from '../../components/Button';
import { Dropdown } from '../../components/Dropdown';
import { showContextMenu } from '../../components/ContextMenuHost';
import type { MenuEntry } from '../../components/menu-types';
import { SEPARATOR } from '../../components/menu-types';
import { VirtualTree, flattenTree } from '../../components/VirtualTree';
import type { TreeRow } from '../../components/VirtualTree';
import { commandEntry } from '../../app/menus';
import { es } from '../../i18n/es';
import { isInside, parentOf, pathKey, refreshFiles, useFilesStore } from '../../stores/files-store';
import type { FileEditing } from '../../stores/files-store';
import { useSettingsStore } from '../../stores/settings-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { newScript, openScript } from '../editor/scripts';
import { SideBarHeader } from '../side-bar/SideBarHeader';
import * as actions from './file-actions';

/** Icono y color por extensión (specs/07; colores de la maqueta). */
function fileIcon(name: string): { icon: string; color: string } {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'sql':
      return { icon: 'database', color: 'var(--icon-sql)' };
    case 'json':
      return { icon: 'json', color: '#CBCB41' };
    case 'csv':
      return { icon: 'table', color: '#89E051' };
    case 'md':
      return { icon: 'markdown', color: 'var(--icon-sql)' };
    default:
      return { icon: 'file', color: 'var(--fg-muted)' };
  }
}

const NEW_ID = '\u0000nuevo';

interface UiFileNode {
  id: string;
  file: FileNode;
  /** Fila del campo "nuevo archivo/carpeta". */
  isNew?: boolean;
  children?: UiFileNode[];
}

type Row = TreeRow & { node: UiFileNode };

/** Nodos visibles: carpetas expandidas con su contenido, filtro por nombre y el campo de creación. */
function buildNodes(
  dir: string,
  dirs: Record<string, FileNode[]>,
  expanded: ReadonlySet<string>,
  editing: FileEditing | null,
  filter: string,
): UiFileNode[] {
  const nodes: UiFileNode[] = [];
  if (editing?.kind === 'new' && pathKey(editing.dir) === pathKey(dir)) {
    nodes.push({
      id: NEW_ID,
      isNew: true,
      file: { name: '', path: `${dir}\\`, dir: editing.type === 'folder' },
      children: editing.type === 'folder' ? [] : undefined,
    });
  }
  for (const file of dirs[pathKey(dir)] ?? []) {
    const key = pathKey(file.path);
    const children = file.dir
      ? expanded.has(key) || filter
        ? buildNodes(file.path, dirs, expanded, editing, filter)
        : []
      : undefined;
    const matches = !filter || file.name.toLowerCase().includes(filter);
    // Con filtro se muestran las coincidencias y las carpetas que las contienen.
    if (filter && !matches && !(children && children.length > 0)) continue;
    nodes.push({ id: key, file, children });
  }
  return nodes;
}

/** Vista Archivos (specs/07): árbol del espacio de trabajo y sus operaciones. */
export function FilesView(): React.JSX.Element {
  const { root, dirs, expanded, selected, editing, clipboard } = useFilesStore();
  const workspace = useWorkspaceStore();
  const tabs = useWorkbenchStore((s) => s.tabs);
  const activeId = useWorkbenchStore((s) => s.activeId);
  const autoReveal = useSettingsStore((s) => s.settings['files.autoReveal']);
  const [sectionOpen, setSectionOpen] = useState(true);
  const [filter, setFilter] = useState('');

  const activePath = tabs.find((t) => t.id === activeId)?.path;
  useEffect(() => {
    if (autoReveal && activePath) void useFilesStore.getState().reveal(activePath);
  }, [activePath, autoReveal]);

  const query = filter.trim().toLowerCase();
  const uiNodes = useMemo(
    () => (root ? buildNodes(root, dirs, expanded, editing, query) : []),
    [root, dirs, expanded, editing, query],
  );
  const expandedIds = useMemo(() => {
    if (!query) return new Set([...expanded, NEW_ID]);
    // Con filtro todo queda expandido para ver las coincidencias.
    return new Set(Object.keys(dirs).concat(NEW_ID));
  }, [expanded, dirs, query]);
  const rows = useMemo(() => flattenTree(uiNodes, expandedIds) as Row[], [uiNodes, expandedIds]);
  const dirty = useMemo(
    () => new Set(tabs.filter((t) => t.dirty && t.path).map((t) => pathKey(t.path!))),
    [tabs],
  );
  const cut = useMemo(() => new Set(clipboard?.cut ? clipboard.paths.map(pathKey) : []), [clipboard]);
  const rootLoaded = root ? dirs[pathKey(root)] : undefined;

  const store = useFilesStore.getState;
  const pathOfId = (id: string): string | null => rows.find((r) => r.id === id)?.node.file.path ?? null;

  const contextEntries = (file: FileNode | null): MenuEntry[] => {
    const isFile = file && !file.dir;
    const entries: MenuEntry[] = [
      commandEntry('db.files.newFile'),
      commandEntry('db.files.newFolder'),
      SEPARATOR,
    ];
    if (isFile) {
      entries.push(
        { type: 'item', id: 'open', label: es.files.open, run: () => void openScript(file.path) },
        commandEntry('db.files.runIn'),
        commandEntry('db.files.openExternal'),
        SEPARATOR,
      );
    }
    entries.push(commandEntry('db.files.cut'), commandEntry('db.files.copy'), commandEntry('db.files.paste'));
    if (file) entries.push(commandEntry('db.files.duplicate'));
    entries.push(SEPARATOR, commandEntry('db.files.copyPath'), commandEntry('db.files.copyRelativePath'));
    entries.push(commandEntry('db.files.reveal'));
    if (file) entries.push(SEPARATOR, commandEntry('db.files.rename'), commandEntry('db.files.delete'));
    return entries;
  };

  return (
    <div className="sidebar-view" data-view="files">
      <SideBarHeader
        title={es.sideBar.filesTitle}
        actions={
          <Dropdown
            className="icon-btn"
            chevron={false}
            title={es.sideBar.more}
            entries={[
              commandEntry('db.workspace.change'),
              commandEntry('db.workspace.openRecent'),
              commandEntry('db.workspace.reveal'),
            ]}
          >
            <Codicon name="ellipsis" />
          </Dropdown>
        }
      />
      <div className="sidebar-section">
        <button
          type="button"
          className="sidebar-section-header"
          aria-expanded={sectionOpen}
          title={workspace.path}
          onClick={() => setSectionOpen((o) => !o)}
        >
          <Codicon name={sectionOpen ? 'chevron-down' : 'chevron-right'} />
          <span>{workspace.name}</span>
        </button>
        <div className="sidebar-section-actions">
          <IconButton
            icon="new-file"
            label={es.sideBar.newFile}
            onClick={() => void actions.startNew('file')}
          />
          <IconButton
            icon="new-folder"
            label={es.sideBar.newFolder}
            onClick={() => void actions.startNew('folder')}
          />
          <IconButton icon="refresh" label={es.sideBar.refresh} onClick={() => refreshFiles()} />
          <IconButton
            icon="collapse-all"
            label={es.sideBar.collapseAll}
            onClick={() => store().collapseAll()}
          />
        </div>
      </div>
      {sectionOpen && filter && (
        <div className="files-filter" data-testid="files-filter">
          <Codicon name="filter" size={14} />
          <span>{filter}</span>
          <IconButton icon="close" label={es.files.clearFilter} onClick={() => setFilter('')} />
        </div>
      )}
      {sectionOpen &&
        (rootLoaded && rootLoaded.length === 0 && !editing ? (
          <div className="empty-state">
            <p>{es.sideBar.workspaceEmpty}</p>
            <Button icon="new-file" onClick={() => void newScript()}>
              {es.sideBar.newScript}
            </Button>
            <button
              type="button"
              className="link-btn"
              onClick={() => void import('./workspace-actions').then((m) => m.changeWorkspace())}
            >
              {es.sideBar.changeWorkspace}
            </button>
          </div>
        ) : (
          <div
            className="files-tree"
            onContextMenu={(e) => {
              // Clic derecho en el espacio vacío: acciones sobre la raíz.
              if ((e.target as Element).closest('.tree-row')) return;
              store().select(null);
              showContextMenu(e, contextEntries(null));
            }}
          >
            <VirtualTree<Row>
              rows={rows}
              ariaLabel={es.sideBar.filesTitle}
              focusContext="filesFocus"
              selectedId={selected ? pathKey(selected) : null}
              onSelect={(id) => store().select(pathOfId(id))}
              onToggle={(id, open) => {
                const path = pathOfId(id);
                if (path) void store().toggle(path, open);
              }}
              onRowClick={(row) => {
                const f = row.node.file;
                if (!row.node.isNew && !f.dir) void openScript(f.path, { preview: true, focus: false });
              }}
              onOpen={(row) => {
                const f = row.node.file;
                if (row.node.isNew) return;
                if (f.dir) void store().toggle(f.path, !expanded.has(pathKey(f.path)));
                else void openScript(f.path);
              }}
              onContextMenu={(row, e) => {
                if (row.node.isNew) return;
                store().select(row.node.file.path);
                showContextMenu(e, contextEntries(row.node.file));
              }}
              onRowKeyDown={(e) => {
                // Filtro por nombre al escribir con el árbol enfocado (specs/07).
                if (e.key === 'Escape' && filter) {
                  setFilter('');
                  return true;
                }
                if (e.key === 'Backspace' && filter) {
                  setFilter((f) => f.slice(0, -1));
                  return true;
                }
                if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && e.key !== ' ') {
                  setFilter((f) => f + e.key);
                  return true;
                }
                return false;
              }}
              dragData={(row) => (row.node.isNew ? null : row.node.file.path)}
              canDrop={(source, target) => {
                if (target.node.isNew) return false;
                const dir = target.node.file.dir ? target.node.file.path : parentOf(target.node.file.path);
                return !isInside(source, dir) && pathKey(parentOf(source)) !== pathKey(dir);
              }}
              onDrop={(source, target) => {
                const dir = target.node.file.dir ? target.node.file.path : parentOf(target.node.file.path);
                void actions.move([source], dir);
              }}
              basePadding={12}
              renderRow={(row) => {
                const { file, isNew } = row.node;
                const icon = file.dir ? null : fileIcon(file.name);
                const renaming = editing?.kind === 'rename' && pathKey(editing.path) === row.id;
                if (isNew || renaming) {
                  return (
                    <>
                      {icon && !isNew && (
                        <Codicon name={icon.icon} color={icon.color} className="tree-icon" />
                      )}
                      {isNew && !file.dir && <Codicon name="file" className="tree-icon" />}
                      <InlineName
                        initial={renaming ? file.name : ''}
                        onCommit={(name) => void actions.commitEditing(editing!, name)}
                        onCancel={() => store().setEditing(null)}
                      />
                    </>
                  );
                }
                return (
                  <>
                    {icon && <Codicon name={icon.icon} color={icon.color} className="tree-icon" />}
                    <span
                      className={[
                        'tree-label',
                        activePath && pathKey(file.path) === pathKey(activePath) ? 'is-open' : '',
                        cut.has(row.id) ? 'is-cut' : '',
                      ].join(' ')}
                    >
                      {file.name}
                    </span>
                    {!file.dir && dirty.has(row.id) && (
                      <span className="tree-modified" title={es.editor.tabs.unsaved} />
                    )}
                  </>
                );
              }}
            />
          </div>
        ))}
    </div>
  );
}

/**
 * Campo en línea para el nombre de un archivo o carpeta (crear o renombrar):
 * Enter confirma, Esc cancela, perder el foco confirma. Valida el nombre
 * mientras se escribe; al renombrar se selecciona el nombre sin la extensión.
 */
function InlineName({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const error = value.trim() ? invalidFileName(value.trim()) : null;

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    const dot = initial.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);

  const finish = (commit: boolean): void => {
    if (done.current) return;
    done.current = true;
    if (commit && !error) onCommit(value);
    else onCancel();
  };

  return (
    <span className="tree-input-wrap">
      <input
        ref={ref}
        className={['tree-input', error ? 'is-invalid' : ''].join(' ')}
        value={value}
        spellCheck={false}
        aria-label={es.files.nameLabel}
        aria-invalid={!!error}
        data-testid="files-inline-input"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // El árbol no debe interpretar las teclas mientras se escribe el nombre.
          e.stopPropagation();
          if (e.key === 'Enter') finish(true);
          else if (e.key === 'Escape') finish(false);
        }}
        onBlur={() => finish(true)}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      />
      {error && <span className="tree-input-error">{error}</span>}
    </span>
  );
}
