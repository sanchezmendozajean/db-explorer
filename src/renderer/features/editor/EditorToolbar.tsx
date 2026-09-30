import { Codicon } from '../../components/Codicon';
import { IconButton } from '../../components/Button';
import { Dropdown } from '../../components/Dropdown';
import { commands } from '../../commands/service';
import { es } from '../../i18n/es';
import { notAvailable } from '../../app/app-commands';
import { SAMPLE_CONNECTIONS, sampleConnection } from '../../sample/sample-data';
import type { EditorTab } from '../../stores/workbench-store';

/** Barra del editor SQL (specs/04 §8). La ejecución llega en M3. */
export function EditorToolbar({ tab }: { tab: EditorTab }): React.JSX.Element {
  const t = es.editor.toolbar;
  const conn = sampleConnection(tab.connectionId);
  return (
    <div className="editor-toolbar">
      <IconButton
        icon="play"
        color="var(--success)"
        label={t.executeStatement}
        onClick={() => notAvailable(t.executeStatement)}
      />
      <IconButton icon="run-all" label={t.executeScript} onClick={() => notAvailable(t.executeScript)} />
      <IconButton icon="debug-stop" label={t.cancel} disabled />
      <IconButton icon="lightbulb" label={t.explain} onClick={() => notAvailable(t.explain)} />
      <span className="toolbar-separator" />
      <Dropdown
        className="chip"
        title={t.connection}
        entries={SAMPLE_CONNECTIONS.map((c) => ({
          type: 'item' as const,
          id: c.id,
          label: c.name,
          checked: c.id === conn?.id,
          run: () => notAvailable(t.connection),
        }))}
      >
        <span
          className="env-dot"
          style={{ background: conn ? `var(--env-${conn.environment})` : 'var(--fg-disabled)' }}
        />
        <span>{conn?.name ?? es.statusBar.noConnection}</span>
      </Dropdown>
      {conn?.database && (
        <Dropdown className="chip" title={t.database} entries={[]}>
          <Codicon name="database" size={14} />
          <span>{conn.database}</span>
        </Dropdown>
      )}
      {conn?.schema && (
        <Dropdown className="chip" title={t.schema} entries={[]}>
          <Codicon name="symbol-namespace" size={14} />
          <span>{conn.schema}</span>
        </Dropdown>
      )}
      <span className="toolbar-separator" />
      <Dropdown
        className="chip"
        title={t.transaction(t.auto)}
        entries={[
          { type: 'item', id: 'auto', label: t.auto, checked: true, run: () => undefined },
          { type: 'item', id: 'manual', label: t.manual, disabled: true, run: () => undefined },
        ]}
      >
        <span>{t.transaction(t.auto)}</span>
      </Dropdown>
      <span className="toolbar-spacer" />
      <IconButton icon="list-selection" label={t.format} onClick={() => notAvailable(t.format)} />
      <IconButton
        icon="layout-panel"
        label={t.togglePanel}
        onClick={() => void commands.execute('db.togglePanel')}
      />
    </div>
  );
}
