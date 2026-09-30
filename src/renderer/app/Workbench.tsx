import { Group, Panel, Separator } from 'react-resizable-panels';
import { ConnectionsView } from '../features/connections/ConnectionsView';
import { FilesView } from '../features/files/FilesView';
import { HistoryView } from '../features/history/HistoryView';
import { EditorGroup } from '../features/editor/EditorGroup';
import { useUiStore } from '../stores/ui-store';
import { ActivityBar } from './ActivityBar';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';

const MAIN_IDS = ['sidebar', 'editor-area'];

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
  const savedLayout = useUiStore((s) => s.layout.main);
  const setMainLayout = useUiStore((s) => s.setMainLayout);
  const fits = !!savedLayout && MAIN_IDS.every((id) => id in savedLayout);

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
            defaultLayout={fits ? savedLayout : undefined}
            onLayoutChanged={(layout) => setMainLayout(layout)}
          >
            <Panel
              id="sidebar"
              defaultSize={280}
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
