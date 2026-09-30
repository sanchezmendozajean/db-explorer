import type { Engine } from '@shared/connection';
import type { SqlDialect, Statement } from '@shared/splitter';
import { analyzeStatement, splitStatements, statementAt } from '@shared/splitter';
import { es } from '../../i18n/es';
import { connectionById } from '../../stores/connections-store';
import { setting } from '../../stores/settings-store';
import { showToast } from '../../stores/toast-store';
import { activeTab, useWorkbenchStore } from '../../stores/workbench-store';
import type { EditorTab } from '../../stores/workbench-store';
import { ensureConnected } from '../connections/actions';
import { askChoice, askWriteConfirm } from '../dialogs/ask';
import { activeEditor } from '../editor/editor-instance';
import { getDocument, languageFor, saveDocument } from '../editor/documents';
import { monacoIfLoaded } from '../editor/monaco/loader';
import type { StatementMeta } from '../results/results-store';
import {
  addMessage,
  beginExecution,
  endExecution,
  markCancelling,
  setLoadingMore,
  tabResults,
  useResultsStore,
  waitForDone,
} from '../results/results-store';
import { useUiStore } from '../../stores/ui-store';

export type ExecuteMode = 'statement' | 'script';

export function dialectOf(engine: Engine | undefined): SqlDialect {
  return engine ?? 'generic';
}

/** Pestañas en las que el usuario marcó "No volver a preguntar" (confirmación de Producción). */
const skipProductionConfirm = new Set<string>();

/** Marcador de errores de ejecución en el modelo de Monaco. */
export const MARKER_OWNER = 'db-explorer';

export function isRunning(tabId: string | undefined): boolean {
  return !!tabId && tabResults(tabId).running !== null;
}

/**
 * Sentencias a ejecutar desde el editor activo (specs/05): con selección,
 * la selección (como script si es `script`, o todas sus sentencias con
 * Ctrl+Enter); sin selección, la sentencia bajo el cursor o el script completo.
 */
function collectStatements(mode: ExecuteMode, dialect: SqlDialect): StatementMeta[] | null {
  const editor = activeEditor();
  const model = editor?.getModel();
  if (!editor || !model) return null;
  const selection = editor.getSelection();
  const toMeta = (s: Statement, base: number): StatementMeta => {
    const pos = model.getPositionAt(base + s.start);
    return { text: s.text, start: base + s.start, startLine: pos.lineNumber, startColumn: pos.column };
  };
  if (selection && !selection.isEmpty()) {
    const base = model.getOffsetAt(selection.getStartPosition());
    return splitStatements(model.getValueInRange(selection), dialect).map((s) => toMeta(s, base));
  }
  const text = model.getValue();
  const all = splitStatements(text, dialect);
  if (mode === 'script') return all.map((s) => toMeta(s, 0));
  const position = editor.getPosition();
  const current = position ? statementAt(text, all, model.getOffsetAt(position)) : undefined;
  return current ? [toMeta(current, 0)] : [];
}

/** Ejecuta desde el editor activo: sentencia bajo el cursor, selección o script completo. */
export async function executeFromEditor(
  mode: ExecuteMode,
  options: { newResultTab?: boolean } = {},
): Promise<void> {
  const tab = activeTab();
  if (!tab || tab.kind !== 'script') return;
  if (isRunning(tab.id)) {
    showToast('info', es.execution.alreadyRunning);
    return;
  }
  const conn = connectionById(tab.connectionId);
  if (!conn) {
    showToast('warning', es.execution.noConnection);
    return;
  }
  const dialect = dialectOf(conn.engine);
  const statements = collectStatements(mode, dialect);
  if (!statements || statements.length === 0) {
    showToast('info', es.execution.nothingToRun);
    return;
  }
  await runStatements(tab, statements, options);
}

/** Validaciones y confirmaciones antes de enviar (specs/08 §Protección). */
async function confirmStatements(tab: EditorTab, statements: StatementMeta[]): Promise<boolean> {
  const conn = connectionById(tab.connectionId)!;
  const dialect = dialectOf(conn.engine);
  const infos = statements.map((s) => ({ s, info: analyzeStatement(s.text, dialect) }));
  const writes = infos.filter((x) => x.info.isWrite);
  if (conn.readOnly && writes.length > 0) {
    showToast('error', es.execution.readOnlyBlocked(conn.name));
    return false;
  }
  const unbounded = infos.filter((x) => x.info.unboundedWrite);
  const production = conn.confirmWrites && writes.length > 0 && !skipProductionConfirm.has(tab.id);
  if (!production && unbounded.length === 0) return true;
  const result = await askWriteConfirm({
    connectionName: conn.name,
    production,
    statements: (production ? writes : unbounded).map((x) => x.s.text),
    unbounded: unbounded.length > 0,
    language: languageFor(conn.engine),
  });
  if (result.confirmed && result.dontAskAgain) skipProductionConfirm.add(tab.id);
  return result.confirmed;
}

async function runStatements(
  tab: EditorTab,
  statements: StatementMeta[],
  options: { newResultTab?: boolean },
): Promise<void> {
  const conn = connectionById(tab.connectionId)!;
  if (!(await confirmStatements(tab, statements))) return;
  if (!(await ensureConnected(conn.id))) return;

  // Con guardado automático, el archivo se guarda antes de ejecutar; si falla, la ejecución sigue (specs/11 §4).
  if (setting('files.autoSave')) await saveDocument(tab.id);

  clearMarkers(tab.id);
  const queryId = crypto.randomUUID();
  const maxRows = effectiveLimit(tab.id);
  beginExecution(tab.id, queryId, statements, { keepPrevious: !!options.newResultTab });
  if (!useUiStore.getState().panel.visible) useUiStore.getState().togglePanel();

  const done = waitForDone(queryId, 'execution');
  const r = await window.api.query.execute({
    queryId,
    sessionId: tab.id,
    connectionId: conn.id,
    database: tab.database,
    schema: tab.schema,
    statements: statements.map((s) => s.text),
    maxRows,
  });
  if (r.ok) {
    await done.promise;
  } else {
    // Falló antes de ejecutar (sin conexión, pestaña ocupada…): no habrá evento de cierre.
    done.cancel();
    addMessage(tab.id, { kind: 'error', text: r.error.message });
    useResultsStore.getState().setActiveView(tab.id, 'messages');
  }
  endExecution(tab.id, queryId);
}

/** Límite de filas de la pestaña (`null` = sin límite). */
export function effectiveLimit(tabId: string): number | null {
  const limit = tabResults(tabId).limit ?? setting('results.maxRows');
  return limit === 'all' ? null : limit;
}

export async function cancelExecution(tabId: string | undefined = activeTab()?.id): Promise<void> {
  if (!tabId) return;
  const running = tabResults(tabId).running;
  if (!running) return;
  markCancelling(tabId);
  await window.api.query.cancel({ queryId: running.queryId });
}

/** Límite a partir del cual "Cargar todo" pide confirmación (specs/06 §Carga). */
const LOAD_ALL_CONFIRM = 100_000;

/** "Cargar más" (un lote del tamaño del límite) o "Cargar todo". */
export async function loadMore(tabId: string, resultId: string, all: boolean): Promise<void> {
  const result = tabResults(tabId).results.find((r) => r.id === resultId);
  if (!result?.hasMore || result.loadingMore) return;
  const fetch = async (count: number | null): Promise<boolean | null> => {
    setLoadingMore(tabId, resultId, true);
    const done = waitForDone(result.queryId, 'fetch');
    const r = await window.api.query.fetchMore({
      queryId: result.queryId,
      statementIndex: result.statementIndex,
      count,
    });
    if (!r.ok) {
      done.cancel();
      setLoadingMore(tabId, resultId, false, false);
      showToast('error', r.error.message);
      return null;
    }
    // Las filas pueden llegar después de la respuesta: se espera el evento de cierre.
    await done.promise;
    setLoadingMore(tabId, resultId, false, r.data.hasMore);
    return r.data.hasMore;
  };
  if (!all) {
    await fetch(effectiveLimit(tabId) ?? setting('results.maxRows'));
    return;
  }
  const loaded = result.rows.length;
  if (loaded < LOAD_ALL_CONFIRM) {
    const more = await fetch(LOAD_ALL_CONFIRM - loaded);
    if (!more) return;
  }
  const answer = await askChoice({
    title: es.results.loadAllTitle,
    message: es.results.loadAllConfirm(LOAD_ALL_CONFIRM),
    buttons: [
      { value: 'yes', label: es.results.loadAllContinue, variant: 'primary' },
      { value: 'no', label: es.dialogs.cancel },
    ],
  });
  if (answer === 'yes') await fetch(null);
}

export function clearMarkers(tabId: string): void {
  const monaco = monacoIfLoaded();
  const doc = getDocument(tabId);
  if (monaco && doc) monaco.editor.setModelMarkers(doc.model, MARKER_OWNER, []);
  const tab = tabResults(tabId);
  if (tab.outcomes.length > 0) {
    useResultsStore.setState((s) => ({ byTab: { ...s.byTab, [tabId]: { ...tab, outcomes: [] } } }));
  }
}

/** Marca de error en la posición informada por el motor (specs/04 §8). */
export function markError(tabId: string, line: number, column: number, message: string): void {
  const monaco = monacoIfLoaded();
  const doc = getDocument(tabId);
  if (!monaco || !doc) return;
  const model = doc.model;
  const safeLine = Math.min(Math.max(1, line), model.getLineCount());
  const word = model.getWordAtPosition({ lineNumber: safeLine, column });
  const endColumn = word ? word.endColumn : Math.min(column + 1, model.getLineMaxColumn(safeLine));
  monaco.editor.setModelMarkers(model, MARKER_OWNER, [
    {
      severity: monaco.MarkerSeverity.Error,
      message,
      startLineNumber: safeLine,
      startColumn: word ? word.startColumn : column,
      endLineNumber: safeLine,
      endColumn: endColumn > column ? endColumn : model.getLineMaxColumn(safeLine),
    },
  ]);
}

/** Lleva el cursor a una línea del editor (enlace "Ir a la línea" de Mensajes). */
export function revealPosition(tabId: string, line: number, column: number): void {
  const editor = activeEditor();
  if (!editor || useWorkbenchStore.getState().activeId !== tabId) return;
  editor.setPosition({ lineNumber: line, column });
  editor.revealPositionInCenterIfOutsideViewport({ lineNumber: line, column });
  editor.focus();
}
