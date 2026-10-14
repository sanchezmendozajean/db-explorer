import { Group, Panel, Separator } from 'react-resizable-panels';
import type { Layout } from 'react-resizable-panels';
import { useUiStore } from '../../stores/ui-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import type { EditorTab } from '../../stores/workbench-store';
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

/**
 * Editor arriba y panel de resultados o mensajes abajo, con el divisor redimensionable.
 * La estructura es fija: ocultar o maximizar el panel no vuelve a crear el editor.
 */
function SplitArea({
  tab,
  showPanel,
  children,
}: {
  tab: EditorTab;
  showPanel: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const panel = useUiStore((s) => s.panel);
  const savedLayout = useUiStore((s) => s.layout.editor);
  const setEditorLayout = useUiStore((s) => s.setEditorLayout);
  const maximized = showPanel && panel.visible && panel.maximized;

  return (
    <Group
      id="editor-split"
      orientation="vertical"
      className={['split', maximized ? 'is-results-maximized' : ''].join(' ')}
      defaultLayout={layoutFits(savedLayout, EDITOR_IDS) ? savedLayout : undefined}
      onLayoutChanged={(layout) => {
        // Con el panel oculto o maximizado no se pisan los tamaños guardados.
        if (panel.visible && !maximized && layoutFits(layout, EDITOR_IDS)) setEditorLayout(layout);
      }}
    >
      <Panel id="editor" minSize={80} defaultSize="60%">
        {children}
      </Panel>
      {showPanel && panel.visible && (
        <>
          <Separator className="sash sash-horizontal" />
          <Panel id="results" minSize={120} defaultSize="40%">
            <ResultsPanel tab={tab} />
          </Panel>
        </>
      )}
    </Group>
  );
}

/**
 * Script: un solo editor Monaco para el grupo (cambiar de pestaña solo cambia su modelo).
 * Los archivos de texto que no son SQL se editan sin barra de ejecución ni resultados.
 */
function ScriptArea({ tab }: { tab: EditorTab }): React.JSX.Element {
  const isSql = /\.sql$/i.test(tab.path ?? '');
  return (
    <SplitArea tab={tab} showPanel={isSql}>
      <div className="editor-pane">
        {isSql && <EditorToolbar tab={tab} />}
        <SqlEditor tab={tab} />
      </div>
    </SplitArea>
  );
}

export function EditorGroup(): React.JSX.Element {
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === s.activeId));
  return (
    <div className="editor-group">
      <EditorTabs />
      <div className="editor-content">
        {!tab ? (
          <Watermark />
        ) : tab.kind === 'object' ? (
          <ObjectView key={tab.id} tab={tab} />
        ) : tab.kind === 'routine' ? (
          <SplitArea tab={tab} showPanel>
            <RoutineView key={tab.id} tab={tab} />
          </SplitArea>
        ) : tab.kind === 'preferences' ? (
          <PreferencesView />
        ) : (
          <ScriptArea tab={tab} />
        )}
      </div>
    </div>
  );
}
