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
const SECONDARY_IDS = ['editor-2', 'results-2'];

function layoutFits(layout: Layout | null, ids: string[]): layout is Layout {
  return !!layout && ids.every((id) => id in layout) && Object.keys(layout).length === ids.length;
}

/**
 * Editor arriba y panel de resultados o mensajes abajo, con el divisor redimensionable.
 * La estructura es fija: ocultar o maximizar el panel no vuelve a crear el editor.
 */
function SplitArea({
  tab,
  group,
  showPanel,
  children,
}: {
  tab: EditorTab;
  group: EditorGroupIndex;
  showPanel: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const panel = useUiStore((s) => s.panel);
  const savedLayout = useUiStore((s) => s.layout.editor);
  const setEditorLayout = useUiStore((s) => s.setEditorLayout);
  const maximized = showPanel && panel.visible && panel.maximized;
  // Los tamaños guardados son los del grupo principal; el dividido empieza con los de siempre.
  const primary = group === 0;
  const ids = primary ? EDITOR_IDS : SECONDARY_IDS;

  return (
    <Group
      id={primary ? 'editor-split' : 'editor-split-2'}
      orientation="vertical"
      className={['split', maximized ? 'is-results-maximized' : ''].join(' ')}
      defaultLayout={primary && layoutFits(savedLayout, EDITOR_IDS) ? savedLayout : undefined}
      onLayoutChanged={(layout) => {
        // Con el panel oculto o maximizado no se pisan los tamaños guardados.
        if (primary && panel.visible && !maximized && layoutFits(layout, EDITOR_IDS)) setEditorLayout(layout);
      }}
    >
      <Panel id={ids[0]} minSize={80} defaultSize="60%">
        {children}
      </Panel>
      {showPanel && panel.visible && (
        <>
          <Separator className="sash sash-horizontal" />
          <Panel id={ids[1]} minSize={120} defaultSize="40%">
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
function ScriptArea({ tab, group }: { tab: EditorTab; group: EditorGroupIndex }): React.JSX.Element {
  const isSql = /\.sql$/i.test(tab.path ?? '');
  return (
    <SplitArea tab={tab} group={group} showPanel={isSql}>
      <div className="editor-pane">
        {isSql && <EditorToolbar tab={tab} />}
        <SqlEditor tab={tab} group={group} />
      </div>
    </SplitArea>
  );
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
          <SplitArea tab={tab} group={group} showPanel>
            <RoutineView key={tab.id} tab={tab} />
          </SplitArea>
        ) : tab.kind === 'preferences' ? (
          <PreferencesView />
        ) : (
          <ScriptArea tab={tab} group={group} />
        )}
      </div>
    </div>
  );
}

/** Los grupos del editor, lado a lado: el dividido solo existe mientras tiene pestañas. */
export function EditorArea(): React.JSX.Element {
  const split = useWorkbenchStore((s) => s.tabs.some((t) => groupOf(t) === 1));
  return (
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
  );
}
