import { Group, Panel, Separator } from 'react-resizable-panels';
import type { Layout } from 'react-resizable-panels';
import { SAMPLE_SCRIPTS } from '../../sample/sample-data';
import { useUiStore } from '../../stores/ui-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import type { EditorTab } from '../../stores/workbench-store';
import { ResultsPanel } from '../results/ResultsPanel';
import { CodePreview } from './CodePreview';
import { EditorTabs } from './EditorTabs';
import { EditorToolbar } from './EditorToolbar';
import { ObjectView } from './ObjectView';
import { Watermark } from './Watermark';

const EDITOR_IDS = ['editor', 'results'];

function layoutFits(layout: Layout | null, ids: string[]): layout is Layout {
  return !!layout && ids.every((id) => id in layout) && Object.keys(layout).length === ids.length;
}

function ScriptArea({ tab }: { tab: EditorTab }): React.JSX.Element {
  const panel = useUiStore((s) => s.panel);
  const savedLayout = useUiStore((s) => s.layout.editor);
  const setEditorLayout = useUiStore((s) => s.setEditorLayout);
  const script = SAMPLE_SCRIPTS[tab.title] ?? {
    lines: [''],
    activeRange: [1, 1] as [number, number],
    cursor: [1, 1] as [number, number],
  };
  // Datos falsos: solo Script-2 "ya se ejecutó" y tiene resultados.
  const hasResults = tab.title === 'Script-2';

  if (panel.visible && panel.maximized) {
    return <ResultsPanel hasResults={hasResults} />;
  }

  const editor = (
    <div className="editor-pane">
      <EditorToolbar tab={tab} />
      <CodePreview lines={script.lines} activeRange={script.activeRange} cursor={script.cursor} />
    </div>
  );

  if (!panel.visible) return editor;

  return (
    <Group
      id="editor-split"
      orientation="vertical"
      className="split"
      defaultLayout={layoutFits(savedLayout, EDITOR_IDS) ? savedLayout : undefined}
      onLayoutChanged={(layout) => setEditorLayout(layout)}
    >
      <Panel id="editor" minSize={80} defaultSize="60%">
        {editor}
      </Panel>
      <Separator className="sash sash-horizontal" />
      <Panel id="results" minSize={120} defaultSize="40%">
        <ResultsPanel hasResults={hasResults} />
      </Panel>
    </Group>
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
          <ObjectView tab={tab} />
        ) : (
          <ScriptArea key={tab.id} tab={tab} />
        )}
      </div>
    </div>
  );
}
