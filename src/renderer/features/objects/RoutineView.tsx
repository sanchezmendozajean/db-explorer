import { useEffect, useRef } from 'react';
import { Button } from '../../components/Button';
import { Codicon } from '../../components/Codicon';
import { dotStyle } from '../../components/env-dot';
import { es } from '../../i18n/es';
import { askChoice } from '../dialogs/ask';
import { connectionById, useConnectionsStore } from '../../stores/connections-store';
import { useUiStore } from '../../stores/ui-store';
import type { EditorTab } from '../../stores/workbench-store';
import { loadMonaco } from '../editor/monaco/loader';
import {
  loadRoutine,
  rememberRoutineViewState,
  routineModel,
  routineViewState,
  saveRoutine,
  useRoutineStore,
} from './routine-tabs';

const t = es.routines;

/** Editor de un procedimiento o función: Ctrl+S (o el botón) aplica el cambio en la base. */
export function RoutineView({ tab }: { tab: EditorTab }): React.JSX.Element {
  const conn = connectionById(tab.connectionId);
  const connected = useConnectionsStore((s) => s.status[tab.connectionId ?? '']?.state === 'connected');
  const status = useRoutineStore((s) => s.byTab[tab.id]);
  const theme = useUiStore((s) => s.effectiveTheme);
  const containerRef = useRef<HTMLDivElement>(null);
  const phase = status?.phase ?? 'loading';
  const ready = phase === 'ready';
  const saving = status?.saving ?? false;
  const object = tab.object;

  useEffect(() => {
    void loadRoutine(tab.id);
  }, [tab.id]);

  // El editor se crea al estar lista la definición y se destruye al cambiar de pestaña (el modelo se conserva).
  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void loadMonaco().then((monaco) => {
      const model = routineModel(tab.id);
      if (disposed || !containerRef.current || !model) return;
      const editor = monaco.editor.create(containerRef.current, {
        model,
        fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
        fontSize: 13,
        fontLigatures: false,
        tabSize: 4,
        insertSpaces: true,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true },
        theme: theme === 'light' ? 'db-light' : 'db-dark',
        ariaLabel: tab.title,
      });
      const view = routineViewState(tab.id);
      if (view) editor.restoreViewState(view);
      editor.focus();
      cleanup = () => {
        rememberRoutineViewState(tab.id, editor.saveViewState());
        editor.dispose();
      };
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [ready, tab.id, tab.title, theme]);

  if (!object || !conn) {
    return (
      <div className="object-view panel-empty">
        <p>{es.objects.unavailable}</p>
      </div>
    );
  }

  const reload = async (): Promise<void> => {
    if (tab.dirty) {
      const answer = await askChoice({
        title: t.reload,
        message: t.reloadConfirm,
        buttons: [
          { value: 'reload', label: t.reload, variant: 'danger' },
          { value: 'cancel', label: es.dialogs.cancel },
        ],
      });
      if (answer !== 'reload') return;
    }
    await loadRoutine(tab.id, { force: true });
  };

  const crumbs: { icon: string; label: string }[] = [{ icon: 'database', label: object.database }];
  if (conn.engine === 'postgres' || conn.engine === 'sqlserver')
    crumbs.push({ icon: 'symbol-namespace', label: object.schema });

  return (
    <div className="object-view" data-focus-context="editorFocus" data-testid="routine-view">
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
            <Codicon name="symbol-method" size={14} />
            {object.name}
          </span>
        </nav>
        <div className="ddl-actions">
          <Button
            small
            variant="secondary"
            icon="refresh"
            disabled={!ready || saving}
            onClick={() => void reload()}
          >
            {t.reload}
          </Button>
          <Button
            small
            variant="primary"
            icon="save"
            disabled={!ready || saving || !tab.dirty || conn.readOnly}
            title={conn.readOnly ? t.readOnly : undefined}
            onClick={() => void saveRoutine(tab.id)}
          >
            {saving ? t.saving : t.save}
          </Button>
        </div>
      </div>
      {saving && <div className="progress-bar" role="progressbar" aria-label={t.saving} />}
      {ready ? (
        <div ref={containerRef} className="ddl-editor" data-testid="routine-editor" />
      ) : phase === 'error' ? null : (
        <div className="panel-body panel-empty">
          <p>{t.loading}</p>
        </div>
      )}
    </div>
  );
}
