import { useMemo, useState } from 'react';
import { Codicon } from '../../components/Codicon';
import { Button, IconButton } from '../../components/Button';
import { Dropdown } from '../../components/Dropdown';
import { VirtualTree, flattenTree } from '../../components/VirtualTree';
import { es } from '../../i18n/es';
import { notAvailable } from '../../app/app-commands';
import type { SampleTreeNode } from '../../sample/sample-data';
import { SAMPLE_FILE_TREE, SAMPLE_FILES_EXPANDED, SAMPLE_WORKSPACE } from '../../sample/sample-data';
import { useSampleStore } from '../../stores/sample-store';
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

export function FilesView(): React.JSX.Element {
  const sampleEnabled = useSampleStore((s) => s.enabled);
  const nodes = useMemo(() => (sampleEnabled ? SAMPLE_FILE_TREE : []), [sampleEnabled]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(SAMPLE_FILES_EXPANDED));
  const [selected, setSelected] = useState<string | null>('paybox/Script-3.sql');
  const [sectionOpen, setSectionOpen] = useState(true);

  const rows = useMemo(() => flattenTree(nodes, expanded), [nodes, expanded]);

  const toggle = (id: string, open: boolean): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

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
          title={SAMPLE_WORKSPACE.path}
          onClick={() => setSectionOpen((o) => !o)}
        >
          <Codicon name={sectionOpen ? 'chevron-down' : 'chevron-right'} />
          <span>{SAMPLE_WORKSPACE.name}</span>
        </button>
        <div className="sidebar-section-actions">
          <IconButton
            icon="new-file"
            label={es.sideBar.newFile}
            onClick={() => notAvailable(es.sideBar.newFile)}
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
            <Button icon="new-file" onClick={() => notAvailable(es.sideBar.newScript)}>
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
            selectedId={selected}
            onSelect={setSelected}
            onToggle={toggle}
            basePadding={12}
            renderRow={(row) => {
              const n: SampleTreeNode = row.node;
              const icon = n.kind === 'file' ? fileIcon(n.label) : null;
              return (
                <>
                  {icon && <Codicon name={icon.icon} color={icon.color} className="tree-icon" />}
                  <span className="tree-label">{n.label}</span>
                  {n.modified && <span className="tree-modified" title={es.editor.tabs.unsaved} />}
                </>
              );
            }}
          />
        ))}
    </div>
  );
}
