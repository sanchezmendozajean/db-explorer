import { useEffect, useState } from 'react';
import { Codicon } from '../../components/Codicon';
import { IconButton } from '../../components/Button';
import { Dropdown } from '../../components/Dropdown';
import { commands } from '../../commands/service';
import { es } from '../../i18n/es';
import { notAvailable } from '../../app/app-commands';
import { useConnectionsStore } from '../../stores/connections-store';
import type { EditorTab } from '../../stores/workbench-store';
import { EMPTY_TAB_RESULTS, useResultsStore } from '../results/results-store';
import { effectiveTarget, hasSessionSchema, pickConnection, pickDatabase, pickSchema } from './target-pickers';

/** Cronómetro "00:03.2" de la ejecución en curso (specs/04 §8). */
export function useElapsed(startedAt: number | undefined): string | null {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (startedAt === undefined) return;
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, [startedAt]);
  if (startedAt === undefined) return null;
  const ms = Math.max(0, now - startedAt);
  const minutes = Math.floor(ms / 60_000);
  const seconds = (ms % 60_000) / 1000;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
}

/** Barra del editor SQL (specs/04 §8). */
export function EditorToolbar({ tab }: { tab: EditorTab }): React.JSX.Element {
  const t = es.editor.toolbar;
  const conn = useConnectionsStore((s) => s.connections.find((c) => c.id === tab.connectionId));
  // Suscripción al estado para refrescar base/esquema predeterminados al conectar.
  useConnectionsStore((s) => (tab.connectionId ? s.status[tab.connectionId] : undefined));
  const running = useResultsStore((s) => (s.byTab[tab.id] ?? EMPTY_TAB_RESULTS).running);
  const elapsed = useElapsed(running?.startedAt);
  const { database, schema } = effectiveTarget(tab);
  const hasDatabases = conn && conn.engine !== 'sqlite';
  const hasSchemas = conn && hasSessionSchema(conn.engine);

  return (
    <div className="editor-toolbar-wrap">
      <div className="editor-toolbar" data-testid="editor-toolbar">
        <IconButton
          icon="play"
          color="var(--success)"
          label={t.executeStatement}
          disabled={!!running}
          onClick={() => void commands.execute('db.executeStatement')}
        />
        <IconButton
          icon="run-all"
          label={t.executeScript}
          disabled={!!running}
          onClick={() => void commands.execute('db.executeScript')}
        />
        <IconButton
          icon="debug-stop"
          color={running ? 'var(--error)' : undefined}
          label={t.cancel}
          disabled={!running || running.cancelling}
          onClick={() => void commands.execute('db.cancel')}
        />
        {elapsed && (
          <span className="toolbar-timer" data-testid="execution-timer">
            {elapsed}
          </span>
        )}
        <IconButton icon="lightbulb" label={t.explain} onClick={() => notAvailable(t.explain)} />
        <span className="toolbar-separator" />
        <button
          type="button"
          className="chip"
          title={t.connection}
          data-testid="connection-chip"
          onClick={() => pickConnection(tab.id)}
        >
          <span
            className="env-dot"
            style={{
              background: conn ? (conn.color ?? `var(--env-${conn.environment})`) : 'var(--fg-disabled)',
            }}
          />
          <span>{conn?.name ?? es.statusBar.noConnection}</span>
          <Codicon name="chevron-down" size={14} className="chip-chevron" />
        </button>
        {hasDatabases && (
          <button
            type="button"
            className="chip"
            title={t.database}
            data-testid="database-chip"
            onClick={() => void pickDatabase(tab.id)}
          >
            <Codicon name="database" size={14} />
            <span>{database ?? t.defaultDatabase}</span>
            <Codicon name="chevron-down" size={14} className="chip-chevron" />
          </button>
        )}
        {hasSchemas && (
          <button
            type="button"
            className="chip"
            title={t.schema}
            data-testid="schema-chip"
            onClick={() => void pickSchema(tab.id)}
          >
            <Codicon name="symbol-namespace" size={14} />
            <span>{schema ?? t.defaultSchema}</span>
            <Codicon name="chevron-down" size={14} className="chip-chevron" />
          </button>
        )}
        <span className="toolbar-separator" />
        <Dropdown
          className="chip"
          title={t.transaction(t.auto)}
          entries={[
            { type: 'item', id: 'auto', label: t.auto, checked: true, run: () => undefined },
            // El modo manual con Commit/Rollback llega en M7.
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
      {running && <div className="progress-bar" role="progressbar" aria-label={es.execution.running} />}
    </div>
  );
}
