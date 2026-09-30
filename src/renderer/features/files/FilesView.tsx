import { useEffect, useMemo, useState } from 'react';
import type { FileNode } from '@shared/workspace';
import { Codicon } from '../../components/Codicon';
import { Button, IconButton } from '../../components/Button';
import { Dropdown } from '../../components/Dropdown';
import { VirtualTree, flattenTree } from '../../components/VirtualTree';
import { es } from '../../i18n/es';
import { notAvailable } from '../../app/app-commands';
import { useFilesStore } from '../../stores/files-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { newScript, openScript, scriptTabId } from '../editor/scripts';
import { SideBarHeader } from '../side-bar/SideBarHeader';

/** Icono y color por extensión (specs/04 §7; colores de la maqueta). */
function fileIcon(name: string): { icon: string; color: string } {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'sql':
      return { icon: 'database', color: 'var(--icon-sql)' };
    case 'json':
      return { icon: 'json', color: '#CBCB41' };
    case 'csv':
      return { icon: 'file', color: '#89E051' };
    case 'md':
      return { icon: 'markdown', color: 'var(--icon-sql)' };
    default:
      return { icon: 'file', color: 'var(--fg-muted)' };
  }
}

interface UiFileNode {
  id: string;
  file: FileNode;
  children?: UiFileNode[];
}

function toUiNodes(nodes: FileNode[]): UiFileNode[] {
  return nodes.map((file) => ({
    id: file.path,
    file,
    children: file.dir ? toUiNodes(file.children ?? []) : undefined,
  }));
}

/**
 * Vista Archivos (specs/04 §7): árbol del espacio de trabajo. En M3 lista y
 * abre scripts; crear, renombrar, mover, eliminar y el watcher llegan en M5.
 */
export function FilesView(): React.JSX.Element {
  const { nodes, load } = useFilesStore();
  const workspace = useWorkspaceStore();
  const tabs = useWorkbenchStore((s) => s.tabs);
  const activeId = useWorkbenchStore((s) => s.activeId);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [sectionOpen, setSectionOpen] = useState(true);

  // Sin watcher (M5): se relee al volver a la ventana.
  useEffect(() => {
    const onFocus = (): void => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const uiNodes = useMemo(() => toUiNodes(nodes), [nodes]);
  const rows = useMemo(() => flattenTree(uiNodes, expanded), [uiNodes, expanded]);
  const activePath = tabs.find((t) => t.id === activeId)?.path;
  const dirty = useMemo(() => new Set(tabs.filter((t) => t.dirty).map((t) => t.id)), [tabs]);

  const toggle = (id: string, open: boolean): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  const open = (file: FileNode): void => {
    if (file.dir) toggle(file.path, !expanded.has(file.path));
    else if (file.name.toLowerCase().endsWith('.sql')) openScript(file.path);
    else notAvailable(es.files.openNonSql);
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
              {
                type: 'item',
                id: 'change',
                label: es.sideBar.changeWorkspace,
                run: () => notAvailable(es.sideBar.changeWorkspace),
              },
              {
                type: 'item',
                id: 'reveal',
                label: es.sideBar.openInExplorer,
                run: () => notAvailable(es.sideBar.openInExplorer),
              },
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
          <IconButton icon="new-file" label={es.sideBar.newFile} onClick={() => void newScript()} />
          <IconButton
            icon="new-folder"
            label={es.sideBar.newFolder}
            onClick={() => notAvailable(es.sideBar.newFolder)}
          />
          <IconButton icon="refresh" label={es.sideBar.refresh} onClick={() => void load()} />
          <IconButton
            icon="collapse-all"
            label={es.sideBar.collapseAll}
            onClick={() => setExpanded(new Set())}
          />
        </div>
      </div>
      {sectionOpen &&
        (nodes.length === 0 ? (
          <div className="empty-state">
            <p>{es.sideBar.workspaceEmpty}</p>
            <Button icon="new-file" onClick={() => void newScript()}>
              {es.sideBar.newScript}
            </Button>
            <button
              type="button"
              className="link-btn"
              onClick={() => notAvailable(es.sideBar.changeWorkspace)}
            >
              {es.sideBar.changeWorkspace}
            </button>
          </div>
        ) : (
          <VirtualTree
            rows={rows}
            ariaLabel={es.sideBar.filesTitle}
            selectedId={selected ?? activePath ?? null}
            onSelect={setSelected}
            onToggle={toggle}
            onOpen={(row) => open(row.node.file)}
            basePadding={12}
            renderRow={(row) => {
              const f = row.node.file;
              const icon = f.dir ? null : fileIcon(f.name);
              return (
                <>
                  {icon && <Codicon name={icon.icon} color={icon.color} className="tree-icon" />}
                  <span className={['tree-label', f.path === activePath ? 'is-open' : ''].join(' ')}>
                    {f.name}
                  </span>
                  {!f.dir && dirty.has(scriptTabId(f.path)) && (
                    <span className="tree-modified" title={es.editor.tabs.unsaved} />
                  )}
                </>
              );
            }}
          />
        ))}
    </div>
  );
}
