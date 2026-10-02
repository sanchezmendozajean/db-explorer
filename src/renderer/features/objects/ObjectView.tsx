import { useEffect, useRef, useState } from 'react';
import type { TableDetails } from '@shared/metadata';
import { quoteIdent } from '@shared/sql-quote';
import { Button, IconButton } from '../../components/Button';
import { Codicon } from '../../components/Codicon';
import { dotStyle } from '../../components/env-dot';
import { es } from '../../i18n/es';
import { connectionById, useConnectionsStore } from '../../stores/connections-store';
import { useUiStore } from '../../stores/ui-store';
import type { EditorTab } from '../../stores/workbench-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import { languageFor } from '../editor/documents';
import { loadMonaco } from '../editor/monaco/loader';
import { newScript } from '../editor/scripts';
import { cancelExecution } from '../execution/execute';
import { ResultSetView } from '../results/ResultsPanel';
import { EMPTY_TAB_RESULTS, useResultsStore } from '../results/results-store';
import { ClauseEditor } from './ClauseEditor';
import { invalidateDetails, tableDetails } from './object-details';
import { fetchDdl, loadObjectData, setObjectState, useObjectTabsStore } from './object-tabs';

const t = es.objects;

type View = NonNullable<EditorTab['objectView']>;

const SUBTABS: { id: View; label: string }[] = [
  { id: 'data', label: es.editor.object.data },
  { id: 'structure', label: es.editor.object.structure },
  { id: 'ddl', label: es.editor.object.ddl },
];

/** Pestaña de objeto (specs/04 §9): breadcrumb, subpestañas Datos · Estructura · DDL. */
export function ObjectView({ tab }: { tab: EditorTab }): React.JSX.Element {
  const conn = connectionById(tab.connectionId);
  const connected = useConnectionsStore((s) => s.status[tab.connectionId ?? '']?.state === 'connected');
  const view = tab.objectView ?? 'data';
  const object = tab.object;
  if (!object || !conn) {
    return (
      <div className="object-view panel-empty">
        <p>{t.unavailable}</p>
      </div>
    );
  }
  const crumbs: { icon: string; label: string }[] = [];
  if (conn.engine !== 'sqlite') crumbs.push({ icon: 'database', label: object.database });
  if (conn.engine === 'postgres' || conn.engine === 'sqlserver')
    crumbs.push({ icon: 'symbol-namespace', label: object.schema });
  const objectIcon = object.kind === 'table' ? 'table' : 'eye';

  return (
    <div
      className="object-view"
      data-focus-context="editorFocus objectFocus"
      tabIndex={-1}
      data-testid="object-view"
    >
      <div className="object-header">
        <nav className="breadcrumb" aria-label={tab.tooltip}>
          <span className="breadcrumb-item">
            <span
              className={connected ? 'env-dot' : 'env-dot is-hollow'}
              style={dotStyle(conn.color ?? `var(--env-${conn.environment})`)}
            />
            {conn.name}
          </span>
          {crumbs.map((c) => (
            <span key={c.icon} className="breadcrumb-item">
              <Codicon name="chevron-right" size={14} className="breadcrumb-sep" />
              <Codicon name={c.icon} size={14} />
              {c.label}
            </span>
          ))}
          <span className="breadcrumb-item">
            <Codicon name="chevron-right" size={14} className="breadcrumb-sep" />
            <Codicon name={objectIcon} size={14} color="var(--icon-table)" />
            {object.name}
          </span>
        </nav>
        <div className="pills" role="tablist">
          {SUBTABS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === view}
              className={['pill', s.id === view ? 'is-active' : ''].join(' ')}
              onClick={() => useWorkbenchStore.getState().update(tab.id, { objectView: s.id })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {view === 'data' && <DataView tab={tab} />}
      {view === 'structure' && <StructureView tab={tab} />}
      {view === 'ddl' && <DdlView tab={tab} />}
    </div>
  );
}

function DataView({ tab }: { tab: EditorTab }): React.JSX.Element {
  const conn = connectionById(tab.connectionId);
  const state = useResultsStore((s) => s.byTab[tab.id] ?? EMPTY_TAB_RESULTS);
  const clauses = useObjectTabsStore((s) => s.byTab[tab.id]);
  const result = state.results[0];
  const error = [...state.messages].reverse().find((m) => m.kind === 'error');
  const started = useRef(false);

  // Primera vez que se muestra: se leen los datos.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (state.results.length === 0 && !state.running) void loadObjectData(tab.id, { force: true });
  }, [tab.id, state.results.length, state.running]);

  const run = (): void => void loadObjectData(tab.id);
  return (
    <>
      <div className="object-filters">
        <div className="clause-input">
          <span>WHERE</span>
          <ClauseEditor
            tabId={tab.id}
            clause="where"
            engine={conn?.engine}
            value={clauses?.where ?? ''}
            label="WHERE"
            onChange={(where) => setObjectState(tab.id, { where })}
            onSubmit={run}
          />
        </div>
        <div className="clause-input is-order">
          <span>ORDER BY</span>
          <ClauseEditor
            tabId={tab.id}
            clause="order"
            engine={conn?.engine}
            value={clauses?.order ?? ''}
            label="ORDER BY"
            onChange={(order) => setObjectState(tab.id, { order })}
            onSubmit={run}
          />
        </div>
        {state.running ? (
          <IconButton
            icon="debug-stop"
            color="var(--error)"
            label={es.editor.toolbar.cancel}
            onClick={() => void cancelExecution(tab.id)}
          />
        ) : (
          <IconButton icon="play" color="var(--success)" label={t.apply} onClick={run} />
        )}
      </div>
      {state.running && <div className="progress-bar" role="progressbar" aria-label={es.execution.running} />}
      {result ? (
        <ResultSetView
          tab={tab}
          result={result}
          onRerun={run}
          onSaved={() => void loadObjectData(tab.id, { force: true })}
          onServerSort={(column, dir) => {
            const quoted = quoteIdent(conn?.engine ?? 'postgres', column);
            setObjectState(tab.id, { order: `${quoted} ${dir.toUpperCase()}` });
            void loadObjectData(tab.id);
          }}
        />
      ) : (
        <div className="panel-body panel-empty">
          {error ? (
            <p className="object-error" data-testid="object-error">
              <Codicon name="error" color="var(--error)" /> {error.text}
            </p>
          ) : (
            <p>{state.running ? es.execution.running : t.loading}</p>
          )}
        </div>
      )}
    </>
  );
}

function useDetails(tab: EditorTab): {
  details: TableDetails | null;
  error: string | null;
  reload: () => void;
} {
  const [details, setDetails] = useState<TableDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    const object = tab.object;
    if (!object || !tab.connectionId) return;
    tableDetails(tab.connectionId, object)
      .then((d) => alive && (setDetails(d), setError(null)))
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [tab.connectionId, tab.object, version]);
  return {
    details,
    error,
    reload: () => {
      if (tab.connectionId && tab.object) invalidateDetails(tab.connectionId, tab.object);
      setVersion((v) => v + 1);
    },
  };
}

function StructureView({ tab }: { tab: EditorTab }): React.JSX.Element {
  const { details, error, reload } = useDetails(tab);
  if (error) {
    return (
      <div className="panel-body panel-empty">
        <p className="object-error">
          <Codicon name="error" color="var(--error)" /> {error}
        </p>
      </div>
    );
  }
  if (!details) {
    return (
      <div className="panel-body panel-empty">
        <p>{t.loading}</p>
      </div>
    );
  }
  const yes = (v: boolean): string => (v ? '✓' : '');
  return (
    <div className="structure" data-testid="structure">
      <div className="structure-actions">
        <IconButton icon="refresh" label={t.refresh} onClick={reload} />
      </div>
      <h3>{t.columns}</h3>
      <table className="structure-table">
        <thead>
          <tr>
            <th>#</th>
            <th>{t.name}</th>
            <th>{t.type}</th>
            <th>{t.nullable}</th>
            <th>{t.default}</th>
            <th>PK</th>
            <th>{t.comment}</th>
          </tr>
        </thead>
        <tbody>
          {details.columns.map((c, i) => (
            <tr key={c.name}>
              <td className="num">{i + 1}</td>
              <td>{c.name}</td>
              <td className="mono">{c.nativeType}</td>
              <td className="center">{yes(c.nullable)}</td>
              <td className="mono">{c.defaultValue ?? ''}</td>
              <td className="center">
                {c.primaryKey ? <Codicon name="key" size={14} color="var(--warning)" /> : ''}
              </td>
              <td>{c.comment ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>{t.indexes}</h3>
      {details.indexes.length === 0 ? (
        <p className="structure-empty">{t.none}</p>
      ) : (
        <table className="structure-table">
          <thead>
            <tr>
              <th>{t.name}</th>
              <th>{t.indexColumns}</th>
              <th>{t.unique}</th>
              <th>{t.primary}</th>
            </tr>
          </thead>
          <tbody>
            {details.indexes.map((x) => (
              <tr key={x.name}>
                <td>{x.name}</td>
                <td className="mono">{x.columns.join(', ')}</td>
                <td className="center">{yes(x.unique)}</td>
                <td className="center">{yes(x.primary)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>{t.constraints}</h3>
      {details.constraints.length === 0 ? (
        <p className="structure-empty">{t.none}</p>
      ) : (
        <table className="structure-table">
          <thead>
            <tr>
              <th>{t.name}</th>
              <th>{t.constraintType}</th>
              <th>{t.indexColumns}</th>
              <th>{t.definition}</th>
            </tr>
          </thead>
          <tbody>
            {details.constraints.map((c, i) => (
              <tr key={`${c.type}:${c.name}:${i}`}>
                <td>{c.name || '—'}</td>
                <td>{t.constraintTypes[c.type]}</td>
                <td className="mono">{c.columns.join(', ')}</td>
                <td className="mono">{c.definition ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DdlView({ tab }: { tab: EditorTab }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ddl, setDdl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const theme = useUiStore((s) => s.effectiveTheme);
  const engine = connectionById(tab.connectionId)?.engine;

  useEffect(() => {
    let alive = true;
    if (!tab.connectionId || !tab.object) return;
    fetchDdl(tab.connectionId, tab.object)
      .then((text) => alive && setDdl(text))
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [tab.connectionId, tab.object]);

  useEffect(() => {
    if (ddl === null) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void loadMonaco().then((monaco) => {
      if (disposed || !containerRef.current) return;
      const model = monaco.editor.createModel(ddl, languageFor(engine));
      const editor = monaco.editor.create(containerRef.current, {
        model,
        readOnly: true,
        fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
        fontSize: 13,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        contextmenu: false,
        theme: theme === 'light' ? 'db-light' : 'db-dark',
        ariaLabel: es.editor.object.ddl,
      });
      cleanup = () => {
        editor.dispose();
        model.dispose();
      };
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [ddl, engine, theme]);

  return (
    <div className="ddl-view">
      <div className="ddl-actions">
        <Button
          small
          variant="secondary"
          icon="go-to-file"
          disabled={ddl === null}
          onClick={() =>
            ddl !== null &&
            void newScript(
              { connectionId: tab.connectionId!, database: tab.object?.database, schema: tab.object?.schema },
              `${ddl}\r\n`,
            )
          }
        >
          {t.openInScript}
        </Button>
      </div>
      {error ? (
        <div className="panel-body panel-empty">
          <p className="object-error">
            <Codicon name="error" color="var(--error)" /> {error}
          </p>
        </div>
      ) : ddl === null ? (
        <div className="panel-body panel-empty">
          <p>{t.loading}</p>
        </div>
      ) : (
        <div ref={containerRef} className="ddl-editor" data-testid="ddl-editor" data-ddl={ddl} />
      )}
    </div>
  );
}
