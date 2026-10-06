import { useEffect } from 'react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import { ConnectionsView } from '../features/connections/ConnectionsView';
import { FilesView } from '../features/files/FilesView';
import { HistoryView } from '../features/history/HistoryView';
import { EditorGroup } from '../features/editor/EditorGroup';
import { useSettingsStore } from '../stores/settings-store';
import { useUiStore } from '../stores/ui-store';
import { ActivityBar } from './ActivityBar';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';

function SideBar(): React.JSX.Element {
  const view = useUiStore((s) => s.sideBar.view);
  return (
    <aside className="sidebar" data-testid="side-bar">
      {view === 'connections' && <ConnectionsView />}
      {view === 'files' && <FilesView />}
      {view === 'history' && <HistoryView />}
    </aside>
  );
}

/** Distribución general (specs/04 §1). */
export function Workbench(): React.JSX.Element {
  const sideBarVisible = useUiStore((s) => s.sideBar.visible);
  const width = useSettingsStore((s) => s.settings['workbench.sideBar.width']);
  const update = useSettingsStore((s) => s.update);
  const sideBarRef = usePanelRef();

  // Un ancho cambiado en settings.json se aplica sin reiniciar.
  useEffect(() => {
    const panel = sideBarRef.current;
    if (panel && Math.abs(panel.getSize().inPixels - width) > 1) panel.resize(width);
  }, [sideBarRef, width]);

  return (
    <div className="workbench">
      <TitleBar />
      <div className="workbench-body">
        <ActivityBar />
        {sideBarVisible ? (
          <Group
            id="main-split"
            orientation="horizontal"
            className="split"
            onLayoutChanged={(_layout, meta) => {
              // Al soltar el borde (o moverlo con el teclado) se guarda el ancho en settings.json.
              const size = sideBarRef.current?.getSize().inPixels;
              if (!meta.isUserInteraction || size === undefined) return;
              const px = Math.max(170, Math.round(size));
              if (px !== width) void update('workbench.sideBar.width', px);
            }}
          >
            <Panel
              id="sidebar"
              panelRef={sideBarRef}
              defaultSize={width}
              minSize={170}
              maxSize="60%"
              groupResizeBehavior="preserve-pixel-size"
            >
              <SideBar />
            </Panel>
            <Separator className="sash sash-vertical" />
            <Panel id="editor-area" minSize={300}>
              <EditorGroup />
            </Panel>
          </Group>
        ) : (
          <div className="split">
            <EditorGroup />
          </div>
        )}
      </div>
      <StatusBar />
    </div>
  );
}
