import { Group, Panel, Separator } from 'react-resizable-panels';
import type { Layout } from 'react-resizable-panels';
import { useUiStore } from '../../stores/ui-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import type { EditorGroupIndex, EditorTab } from '../../stores/workbench-store';
import { groupOf } from '../../stores/workbench-store';
import { ResultsPanel } from '../results/ResultsPanel';
import { EditorTabs } from './EditorTabs';
import { EditorToolbar } from './EditorToolbar';
import { PreferencesView } from '../preferences/PreferencesView';
import { ObjectView } from '../objects/ObjectView';
import { RoutineView } from '../objects/RoutineView';
import { SqlEditor } from './SqlEditor';
import { Watermark } from './Watermark';

const EDITOR_IDS = ['editor', 'results'];

function layoutFits(layout: Layout | null, ids: string[]): layout is Layout {
  return !!layout && ids.every((id) => id in layout) && Object.keys(layout).length === ids.length;
}

/** ¿La pestaña tiene panel de resultados o mensajes? Scripts SQL y rutinas; los demás archivos de texto, no. */
function hasResultsPanel(tab: EditorTab | undefined): tab is EditorTab {
  if (!tab) return false;
  return tab.kind === 'routine' || (tab.kind === 'script' && /.sql$/i.test(tab.path ?? ''));
}

/** Un grupo de editor: su barra de pestañas y el contenido de la pestaña visible. */
function EditorGroup({ group }: { group: EditorGroupIndex }): React.JSX.Element {
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === s.groupActive[group]));
  const focusGroup = useWorkbenchStore((s) => s.focusGroup);
  return (
    // Un clic en cualquier parte del grupo lo enfoca (su pestaña visible pasa a ser la activa).
    <div className="editor-group" data-group={group} onMouseDownCapture={() => focusGroup(group)}>
      <EditorTabs group={group} />
      <div className="editor-content">
        {!tab ? (
          <Watermark />
        ) : tab.kind === 'object' ? (
          <ObjectView key={tab.id} tab={tab} />
        ) : tab.kind === 'routine' ? (
          <RoutineView key={tab.id} tab={tab} />
        ) : tab.kind === 'preferences' ? (
          <PreferencesView />
        ) : (
          <div className="editor-pane">
            {hasResultsPanel(tab) && <EditorToolbar tab={tab} />}
            <SqlEditor tab={tab} group={group} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Los grupos del editor, lado a lado (el dividido solo existe mientras tiene pestañas), y debajo un
 * único panel de resultados de ancho completo que muestra el de la pestaña enfocada, como el panel de VS Code.
 * La estructura es fija: ocultar o maximizar el panel no vuelve a crear los editores.
 */
export function EditorArea(): React.JSX.Element {
  const split = useWorkbenchStore((s) => s.tabs.some((t) => groupOf(t) === 1));
  const focused = useWorkbenchStore((s) => s.tabs.find((t) => t.id === s.activeId));
  const panel = useUiStore((s) => s.panel);
  const savedLayout = useUiStore((s) => s.layout.editor);
  const setEditorLayout = useUiStore((s) => s.setEditorLayout);
  const showPanel = hasResultsPanel(focused) && panel.visible;
  const maximized = showPanel && panel.maximized;

  return (
    <Group
      id="editor-split"
      orientation="vertical"
      className={['split', maximized ? 'is-results-maximized' : ''].join(' ')}
      defaultLayout={layoutFits(savedLayout, EDITOR_IDS) ? savedLayout : undefined}
      onLayoutChanged={(layout) => {
        // Con el panel oculto o maximizado no se pisan los tamaños guardados.
        if (showPanel && !maximized && layoutFits(layout, EDITOR_IDS)) setEditorLayout(layout);
      }}
    >
      <Panel id="editor" minSize={80} defaultSize="60%">
        <Group id="editor-groups" orientation="horizontal" className="split">
          <Panel id="group-primary" minSize={200}>
            <EditorGroup group={0} />
          </Panel>
          {split && (
            <>
              <Separator className="sash sash-vertical" />
              <Panel id="group-secondary" minSize={200}>
                <EditorGroup group={1} />
              </Panel>
            </>
          )}
        </Group>
      </Panel>
      {showPanel && (
        <>
          <Separator className="sash sash-horizontal" />
          <Panel id="results" minSize={120} defaultSize="40%">
            <ResultsPanel tab={focused} />
          </Panel>
        </>
      )}
    </Group>
  );
}
