import { create } from 'zustand';
import type { CellValue, QueryEvent, ResultColumn } from '@shared/query';
import { es } from '../../i18n/es';

/** Sentencia enviada al motor, con su posición en el editor (para marcas y errores). */
export interface StatementMeta {
  text: string;
  /** Offset absoluto en el modelo del editor. */
  start: number;
  startLine: number;
  startColumn: number;
}

/** Result set en el renderer (specs/06 §Modelo de datos). Las filas se agregan en el mismo arreglo. */
export interface ResultSet {
  id: string;
  queryId: string;
  statementIndex: number;
  /** "Resultado N" o el nombre de la tabla principal si se detecta. */
  title: string;
  columns: ResultColumn[];
  rows: CellValue[][];
  /** Cambia cada vez que llegan filas (la grilla se redibuja). */
  version: number;
  truncated: boolean;
  /** Se puede pedir "Cargar más" (cursor abierto en el db-host). */
  hasMore: boolean;
  loadingMore: boolean;
  done: boolean;
  durationMs: number;
  executedAt: string;
  pinned: boolean;
  /** Estado de vista (specs/06): filtro rápido y orden en cliente, columnas ocultas y anchos. */
  view: ResultView;
}

export interface ResultView {
  filter: string;
  sort: { column: number; dir: 'asc' | 'desc' } | null;
  hidden: number[];
  widths: Record<number, number>;
}

export type MessageKind = 'info' | 'notice' | 'warning' | 'error';

export interface MessageEntry {
  id: number;
  time: string;
  kind: MessageKind;
  text: string;
  /** Posición del error en el editor ("Ir a la línea"). */
  line?: number;
  column?: number;
}

export interface RunningQuery {
  queryId: string;
  /** `performance.now()` al empezar (cronómetro). */
  startedAt: number;
  statements: StatementMeta[];
  cancelling: boolean;
}

export interface TabResults {
  running: RunningQuery | null;
  results: ResultSet[];
  messages: MessageEntry[];
  /** Vista activa del panel: id de resultado o `messages`. */
  activeView: string;
  /** Límite elegido en la barra de resultados; `null` = el de settings (`results.maxRows`). */
  limit: number | 'all' | null;
  /** Estado de cada sentencia de la última ejecución, para el gutter del editor. */
  outcomes: { line: number; ok: boolean }[];
  /** Sentencias de la última ejecución ("Re-ejecutar"). */
  lastRun: StatementMeta[];
}

interface ResultsStore {
  byTab: Record<string, TabResults>;
  setActiveView: (tabId: string, view: string) => void;
  setLimit: (tabId: string, limit: number | 'all' | null) => void;
  togglePin: (tabId: string, resultId: string) => void;
  updateView: (tabId: string, resultId: string, view: Partial<ResultView>) => void;
  clear: (tabId: string) => void;
}

export const EMPTY_TAB_RESULTS: TabResults = {
  running: null,
  results: [],
  messages: [],
  activeView: 'messages',
  limit: null,
  outcomes: [],
  lastRun: [],
};

export const useResultsStore = create<ResultsStore>((set) => ({
  byTab: {},
  setActiveView: (tabId, view) => set((s) => ({ byTab: patch(s.byTab, tabId, { activeView: view }) })),
  setLimit: (tabId, limit) => set((s) => ({ byTab: patch(s.byTab, tabId, { limit }) })),
  togglePin: (tabId, resultId) =>
    set((s) => ({
      byTab: patch(s.byTab, tabId, {
        results: tabOf(s.byTab, tabId).results.map((r) =>
          r.id === resultId ? { ...r, pinned: !r.pinned } : r,
        ),
      }),
    })),
  updateView: (tabId, resultId, view) =>
    set((s) => ({
      byTab: patch(s.byTab, tabId, {
        results: tabOf(s.byTab, tabId).results.map((r) =>
          r.id === resultId ? { ...r, view: { ...r.view, ...view } } : r,
        ),
      }),
    })),
  clear: (tabId) =>
    set((s) => ({ byTab: Object.fromEntries(Object.entries(s.byTab).filter(([id]) => id !== tabId)) })),
}));

function tabOf(byTab: Record<string, TabResults>, tabId: string): TabResults {
  return byTab[tabId] ?? EMPTY_TAB_RESULTS;
}

function patch(
  byTab: Record<string, TabResults>,
  tabId: string,
  changes: Partial<TabResults>,
): Record<string, TabResults> {
  return { ...byTab, [tabId]: { ...tabOf(byTab, tabId), ...changes } };
}

const get = (): Record<string, TabResults> => useResultsStore.getState().byTab;
const put = (tabId: string, changes: Partial<TabResults>): void =>
  useResultsStore.setState((s) => ({ byTab: patch(s.byTab, tabId, changes) }));

export function tabResults(tabId: string): TabResults {
  return tabOf(get(), tabId);
}

let nextMessageId = 1;

export function clockTime(date = new Date()): string {
  return date.toLocaleTimeString('es', { hour12: false });
}

export function addMessage(tabId: string, message: Omit<MessageEntry, 'id' | 'time'>): void {
  const current = tabResults(tabId);
  put(tabId, { messages: [...current.messages, { ...message, id: nextMessageId++, time: clockTime() }] });
}

/** Consulta → pestaña, para enrutar los eventos que llegan del db-host. */
const queryTabs = new Map<string, string>();

/** Comienza una ejecución: descarta los resultados no fijados (salvo "en nueva pestaña de resultado"). */
export function beginExecution(
  tabId: string,
  queryId: string,
  statements: StatementMeta[],
  options: { keepPrevious: boolean },
): void {
  queryTabs.set(queryId, tabId);
  const current = tabResults(tabId);
  for (const r of current.results) if (!r.pinned && !options.keepPrevious) queryTabs.delete(r.queryId);
  put(tabId, {
    running: { queryId, startedAt: performance.now(), statements, cancelling: false },
    results: options.keepPrevious ? current.results : current.results.filter((r) => r.pinned),
    messages: options.keepPrevious ? current.messages : [],
    outcomes: [],
    lastRun: statements,
  });
}

export function endExecution(tabId: string, queryId: string): void {
  flushNow();
  const current = tabResults(tabId);
  if (current.running?.queryId !== queryId) return;
  // Sin result sets, se muestra la pestaña Mensajes.
  const hasResult = current.results.some((r) => r.queryId === queryId);
  put(tabId, { running: null, activeView: hasResult ? current.activeView : 'messages' });
}

export function markCancelling(tabId: string): void {
  const current = tabResults(tabId);
  if (current.running) put(tabId, { running: { ...current.running, cancelling: true } });
}

/** Resultados con filas nuevas pendientes de publicar en el store (se agrupan por cuadro). */
const dirtyResults = new Map<string, Set<string>>();
let frame: number | null = null;

function scheduleFlush(tabId: string, resultId: string): void {
  let set = dirtyResults.get(tabId);
  if (!set) {
    set = new Set();
    dirtyResults.set(tabId, set);
  }
  set.add(resultId);
  frame ??= requestAnimationFrame(flushNow);
}

function flushNow(): void {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  if (dirtyResults.size === 0) return;
  const pending = new Map(dirtyResults);
  dirtyResults.clear();
  useResultsStore.setState((s) => {
    let byTab = s.byTab;
    for (const [tabId, ids] of pending) {
      const tab = tabOf(byTab, tabId);
      byTab = patch(byTab, tabId, {
        results: tab.results.map((r) => (ids.has(r.id) ? { ...r, version: r.version + 1 } : r)),
      });
    }
    return { byTab };
  });
}

/** Resultados de una sentencia, en orden (una sentencia puede devolver varios: `EXEC`, `CALL`, bloques). */
function resultsOf(tabId: string, queryId: string, index: number): ResultSet[] {
  return tabResults(tabId).results.filter((r) => r.queryId === queryId && r.statementIndex === index);
}

/** Resultado que recibe las filas: el último de la sentencia. */
function findResult(tabId: string, queryId: string, index: number): ResultSet | undefined {
  return resultsOf(tabId, queryId, index).at(-1);
}

function updateResult(tabId: string, id: string, changes: Partial<ResultSet>): void {
  const tab = tabResults(tabId);
  put(tabId, { results: tab.results.map((r) => (r.id === id ? { ...r, ...changes } : r)) });
}

/** Título de un resultado: la tabla de origen si todas las columnas vienen de la misma. */
function resultTitle(columns: ResultColumn[], ordinal: number): string {
  const tables = new Set(columns.map((c) => c.sourceTable));
  const [only] = [...tables];
  return tables.size === 1 && only ? only : es.results.result(ordinal);
}

export interface ExecutionCallbacks {
  onStatementError?: (
    tabId: string,
    meta: StatementMeta | undefined,
    event: Extract<QueryEvent, { type: 'statement-error' }>,
  ) => void;
  onStatementDone?: (tabId: string) => void;
}

let callbacks: ExecutionCallbacks = {};
export function setExecutionCallbacks(cb: ExecutionCallbacks): void {
  callbacks = cb;
}

type DoneEvent = Extract<QueryEvent, { type: 'execution-done' | 'fetch-done' }>;
const waiters = new Map<string, (event: DoneEvent) => void>();

/**
 * Espera el evento de cierre de una ejecución (`execution-done`) o de un
 * "Cargar más" (`fetch-done`): llegan después de todas las filas.
 */
export function waitForDone(
  queryId: string,
  kind: 'execution' | 'fetch',
): { promise: Promise<DoneEvent>; cancel: () => void } {
  const key = `${kind}:${queryId}`;
  let cancel = (): void => undefined;
  const promise = new Promise<DoneEvent>((resolve) => {
    waiters.set(key, resolve);
    cancel = () => waiters.delete(key);
  });
  return { promise, cancel };
}

/** Aplica un evento de ejecución del db-host al estado de la pestaña correspondiente. */
export function applyQueryEvent(event: QueryEvent): void {
  if (event.type === 'execution-done' || event.type === 'fetch-done') {
    flushNow();
    const key = `${event.type === 'execution-done' ? 'execution' : 'fetch'}:${event.queryId}`;
    waiters.get(key)?.(event);
    waiters.delete(key);
    return;
  }
  const tabId = queryTabs.get(event.queryId);
  if (!tabId) return;
  const tab = tabResults(tabId);
  const meta = tab.running?.queryId === event.queryId ? tab.running.statements[event.index] : undefined;
  switch (event.type) {
    case 'statement-start':
      break;
    case 'columns': {
      const ordinal = tab.results.length + 1;
      const previous = resultsOf(tabId, event.queryId, event.index);
      // El resultado anterior de la misma sentencia ya recibió todas sus filas.
      for (const r of previous) if (!r.done) updateResult(tabId, r.id, { done: true });
      const result: ResultSet = {
        id: `${event.queryId}:${event.index}${previous.length > 0 ? `:${previous.length}` : ''}`,
        queryId: event.queryId,
        statementIndex: event.index,
        title: resultTitle(event.columns, ordinal),
        columns: event.columns,
        rows: [],
        version: 0,
        truncated: false,
        hasMore: false,
        loadingMore: false,
        done: false,
        durationMs: 0,
        executedAt: clockTime(),
        pinned: false,
        view: { filter: '', sort: null, hidden: [], widths: {} },
      };
      // El primer resultado de la ejecución pasa a ser la vista activa.
      const first = !tab.results.some((r) => r.queryId === event.queryId);
      put(tabId, {
        results: [...tabResults(tabId).results, result],
        activeView: first ? result.id : tab.activeView,
      });
      break;
    }
    case 'rows': {
      const result = findResult(tabId, event.queryId, event.index);
      if (!result) return;
      for (const row of event.rows) result.rows.push(row);
      scheduleFlush(tabId, result.id);
      break;
    }
    case 'statement-done': {
      flushNow();
      const results = resultsOf(tabId, event.queryId, event.index);
      const result = results.at(-1);
      for (const r of results) {
        // Truncado y "Cargar más" se refieren al último resultado de la sentencia.
        updateResult(tabId, r.id, {
          truncated: r === result ? event.truncated : false,
          hasMore: r === result ? event.hasMore : false,
          done: true,
          durationMs: event.durationMs,
        });
      }
      const text =
        event.affected !== undefined
          ? es.execution.affected(event.command, event.affected)
          : result
            ? es.execution.returned(event.rowCount, event.truncated)
            : es.execution.completed(event.command || 'OK');
      addMessage(tabId, { kind: 'info', text: `${text} · ${es.units.ms(event.durationMs)}` });
      if (meta) {
        put(tabId, { outcomes: [...tabResults(tabId).outcomes, { line: meta.startLine, ok: true }] });
      }
      callbacks.onStatementDone?.(tabId);
      break;
    }
    case 'statement-error': {
      flushNow();
      let line = meta?.startLine;
      let column = meta?.startColumn;
      if (meta && event.position !== undefined) {
        const pos = positionInStatement(meta, event.position);
        line = pos.line;
        column = pos.column;
      }
      const lines = [event.cancelled ? es.execution.cancelled : event.message];
      if (event.detail) lines.push(es.execution.detail(event.detail));
      if (event.hint) lines.push(es.execution.hint(event.hint));
      addMessage(tabId, { kind: 'error', text: lines.join('\n'), line, column });
      // Un error muestra la pestaña Mensajes; al cancelar se conservan las filas ya recibidas a la vista.
      const now = tabResults(tabId);
      const keepView = event.cancelled && now.results.some((r) => r.queryId === event.queryId);
      put(tabId, {
        outcomes: meta ? [...now.outcomes, { line: meta.startLine, ok: false }] : now.outcomes,
        activeView: keepView ? now.activeView : 'messages',
      });
      callbacks.onStatementError?.(tabId, meta, event);
      break;
    }
    case 'message':
      addMessage(tabId, { kind: event.severity === 'warning' ? 'warning' : 'notice', text: event.text });
      break;
  }
}

/** Línea y columna (1-based) de una posición 1-based dentro del texto de una sentencia. */
export function positionInStatement(meta: StatementMeta, position: number): { line: number; column: number } {
  const before = meta.text.slice(0, Math.max(0, position - 1));
  const newlines = before.split('\n');
  const extraLines = newlines.length - 1;
  const lastLine = newlines[newlines.length - 1] ?? '';
  return extraLines === 0
    ? { line: meta.startLine, column: meta.startColumn + lastLine.length }
    : { line: meta.startLine + extraLines, column: lastLine.length + 1 };
}

export function setLoadingMore(
  tabId: string,
  resultId: string,
  loadingMore: boolean,
  hasMore?: boolean,
): void {
  flushNow();
  const changes: Partial<ResultSet> = { loadingMore };
  if (hasMore !== undefined) {
    changes.hasMore = hasMore;
    if (!hasMore) changes.truncated = false;
  }
  updateResult(tabId, resultId, changes);
}

/** El db-host se reinició: ninguna ejecución sigue viva ni hay cursores abiertos. */
export function resetAllRunning(): void {
  for (const [key, resolve] of waiters) {
    const [kind, queryId] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    resolve(
      kind === 'execution'
        ? {
            type: 'execution-done',
            queryId,
            summary: { queryId, executed: 0, failed: true, cancelled: false, durationMs: 0 },
          }
        : { type: 'fetch-done', queryId, index: 0, result: null, error: es.toasts.dbHostRestarted },
    );
  }
  waiters.clear();
  useResultsStore.setState((s) => {
    const byTab: Record<string, TabResults> = {};
    for (const [id, tab] of Object.entries(s.byTab)) {
      byTab[id] = {
        ...tab,
        running: null,
        results: tab.results.map((r) => ({ ...r, hasMore: false, loadingMore: false })),
      };
    }
    return { byTab };
  });
  queryTabs.clear();
}

export function forgetTab(tabId: string): void {
  for (const [q, t] of queryTabs) if (t === tabId) queryTabs.delete(q);
  useResultsStore.getState().clear(tabId);
}
