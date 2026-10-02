import { create } from 'zustand';
import { withoutKey } from '@shared/records';
import type { Engine } from '@shared/connection';
import type { ObjectKind, TreeNodeRef } from '@shared/metadata';
import { nodeKey } from '@shared/metadata';
import { qualifiedName } from '@shared/sql-quote';
import { es } from '../../i18n/es';
import { connectionById } from '../../stores/connections-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import type { EditorTab } from '../../stores/workbench-store';
import { ensureConnected } from '../connections/actions';
import { effectiveLimit } from '../execution/execute';
import { forgetTransaction } from '../execution/transactions';
import { confirmDiscardGridChanges, hasPendingChanges } from '../results/grid-edit';
import {
  addMessage,
  beginExecution,
  endExecution,
  forgetTab,
  tabResults,
  waitForDone,
} from '../results/results-store';
import type { ObjectRefData } from './object-details';
import type { CatalogObject } from '../editor/catalog';
import { revealObject } from '../editor/catalog';

/**
 * Pestaña de objeto (specs/04 §9): Datos con WHERE/ORDER BY, Estructura y
 * DDL. Los datos se leen en una sesión propia de la pestaña (la misma con la
 * que se guardan las ediciones), con límite y "Cargar más".
 */

interface ObjectTabState {
  where: string;
  order: string;
}

export const useObjectTabsStore = create<{ byTab: Record<string, ObjectTabState> }>(() => ({ byTab: {} }));

const EMPTY: ObjectTabState = { where: '', order: '' };

export function objectState(tabId: string): ObjectTabState {
  return useObjectTabsStore.getState().byTab[tabId] ?? EMPTY;
}

export function setObjectState(tabId: string, changes: Partial<ObjectTabState>): void {
  useObjectTabsStore.setState((s) => ({
    byTab: { ...s.byTab, [tabId]: { ...objectState(tabId), ...changes } },
  }));
}

export const DATA_KINDS: ObjectKind[] = ['table', 'view', 'materializedView'];

export function objectTabId(connectionId: string, ref: ObjectRefData): string {
  const nodeRef: TreeNodeRef = {
    kind: 'object',
    database: ref.database,
    schema: ref.schema,
    objectKind: ref.kind,
    name: ref.name,
  };
  return `object:${nodeKey(connectionId, nodeRef)}`;
}

/** Libera la sesión y los resultados de una pestaña de objeto que se cierra o se reemplaza. */
export function disposeObjectTab(tabId: string): void {
  void window.api.query.closeSession({ sessionId: tabId });
  forgetTab(tabId);
  forgetTransaction(tabId);
  useObjectTabsStore.setState((s) => ({ byTab: withoutKey(s.byTab, tabId) }));
}

/**
 * Abre (o enfoca) la pestaña de un objeto en la subpestaña pedida. Desde el
 * árbol se abre como vista previa: reemplaza a la vista previa anterior.
 */
export function openObjectTab(
  connectionId: string,
  ref: ObjectRefData,
  view: 'data' | 'structure' | 'ddl' = 'data',
  options: { preview?: boolean } = {},
): void {
  const conn = connectionById(connectionId);
  if (!conn) return;
  const wb = useWorkbenchStore.getState();
  const id = objectTabId(connectionId, ref);
  const existing = wb.tabs.find((t) => t.id === id);
  if (existing) {
    wb.update(id, { objectView: view });
    wb.activate(id);
    return;
  }
  const preview = options.preview ?? true;
  if (preview) {
    // La vista previa anterior (si es de objeto y sin cambios) se reemplaza: su sesión se cierra.
    const old = wb.tabs.find((t) => t.preview);
    if (old && old.kind === 'object') {
      if (hasPendingChanges(old.id)) wb.pin(old.id);
      else disposeObjectTab(old.id);
    }
  }
  const crumbs = [
    conn.name,
    ...(conn.engine === 'sqlite' ? [] : [ref.database]),
    ...(conn.engine === 'postgres' || conn.engine === 'sqlserver' ? [ref.schema] : []),
    ref.name,
  ];
  const tab: EditorTab = {
    id,
    kind: 'object',
    title: ref.name,
    tooltip: crumbs.join(' › '),
    connectionId,
    database: ref.database,
    schema: ref.schema,
    dirty: false,
    preview,
    object: ref,
    objectView: view,
  };
  wb.open(tab);
}

export function objectDataSql(engine: Engine, ref: ObjectRefData, where: string, order: string): string {
  const table = qualifiedName(engine, {
    schema: engine === 'sqlite' ? undefined : ref.schema,
    name: ref.name,
  });
  let sql = `SELECT * FROM ${table}`;
  if (where.trim()) sql += ` WHERE ${where.trim()}`;
  if (order.trim()) sql += ` ORDER BY ${order.trim()}`;
  return sql;
}

/** Ejecuta la consulta de la subpestaña Datos con el WHERE y ORDER BY actuales. */
export async function loadObjectData(tabId: string, options: { force?: boolean } = {}): Promise<void> {
  const tab = useWorkbenchStore.getState().tabs.find((t) => t.id === tabId);
  const conn = connectionById(tab?.connectionId);
  if (!tab?.object || !conn) return;
  if (tabResults(tabId).running) return;
  if (!options.force && !(await confirmDiscardGridChanges(tabId))) return;
  if (!(await ensureConnected(conn.id))) return;
  const { where, order } = objectState(tabId);
  const sql = objectDataSql(conn.engine, tab.object, where, order);
  const queryId = crypto.randomUUID();
  beginExecution(tabId, queryId, [{ text: sql, start: 0, startLine: 1, startColumn: 1 }], {
    keepPrevious: false,
  });
  const done = waitForDone(queryId, 'execution');
  const r = await window.api.query.execute({
    queryId,
    sessionId: tabId,
    connectionId: conn.id,
    database: tab.object.database,
    schema: tab.object.schema,
    statements: [sql],
    maxRows: effectiveLimit(tabId),
    history: false,
  });
  if (r.ok) await done.promise;
  else {
    done.cancel();
    addMessage(tabId, { kind: 'error', text: r.error.message });
  }
  endExecution(tabId, queryId);
}

/** Texto del objeto para "Abrir en script" del DDL y "Nuevo script ▸ DDL" del árbol. */
export async function fetchDdl(connectionId: string, ref: ObjectRefData): Promise<string> {
  const r = await window.api.meta.ddl({ connectionId, ...ref });
  if (!r.ok) throw new Error(r.error.message);
  return r.data.ddl || es.objects.noDdl;
}

/** Ctrl+P y F12 sobre un objeto (specs/05): tablas y vistas en su pestaña; el resto, en el árbol. */
export function openCatalogObject(connectionId: string, object: CatalogObject): void {
  if (DATA_KINDS.includes(object.kind)) {
    openObjectTab(
      connectionId,
      { database: object.database, schema: object.schema, name: object.name, kind: object.kind },
      'data',
      { preview: false },
    );
  } else {
    revealObject(connectionId, object);
  }
}
