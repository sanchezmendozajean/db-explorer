import { create } from 'zustand';
import { withoutKey } from '@shared/records';
import type { ColumnInfo } from '@shared/metadata';
import {
  buildAlterStatements,
  buildCreateStatements,
  columnFromInfo,
  newDesignColumn,
  validateDesign,
  type DesignColumn,
  type DesignIssue,
  type TableDesign,
} from '@shared/table-design';
import { es } from '../../i18n/es';
import { connectionById, useConnectionsStore } from '../../stores/connections-store';
import { useOverlayStore } from '../../stores/overlay-store';
import { showToast } from '../../stores/toast-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import { ensureConnected } from '../connections/actions';
import { askChoice, askWriteConfirm } from '../dialogs/ask';
import { languageFor } from '../editor/documents';
import { invalidateDetails, tableDetails } from './object-details';
import { openObjectTab } from './object-tabs';

/**
 * Estado de la pestaña Estructura editable (specs/04 §9): el borrador de columnas de cada pestaña de
 * tabla, sus cambios sin guardar y el guardado (`CREATE TABLE` o `ALTER TABLE`). Un nombre de tabla
 * vacío en una pestaña `newTable` significa que la tabla aún no existe.
 */

export interface DesignState {
  design: TableDesign;
  /** Instantánea (JSON) del diseño sin cambios, para saber si hay algo por guardar. */
  base: string;
  /** Columnas leídas de la base (vacío en una tabla nueva), para descartar los cambios. */
  source: ColumnInfo[];
  issues: DesignIssue[];
  /** Errores de validación visibles (aparecen al primer intento de guardar). */
  showIssues: boolean;
  error: string | null;
  saving: boolean;
}

export const useDesignStore = create<{ byTab: Record<string, DesignState> }>(() => ({ byTab: {} }));

let sequence = 0;
const nextKey = (): string => `col-${++sequence}`;

const wb = useWorkbenchStore.getState;
const tabOf = (tabId: string) => wb().tabs.find((t) => t.id === tabId);
const engineOf = (tabId: string) => connectionById(tabOf(tabId)?.connectionId)?.engine ?? 'postgres';

export function designOf(tabId: string): DesignState | undefined {
  return useDesignStore.getState().byTab[tabId];
}

function put(tabId: string, change: (s: DesignState) => DesignState): void {
  useDesignStore.setState((all) => {
    const current = all.byTab[tabId];
    return current ? { byTab: { ...all.byTab, [tabId]: change(current) } } : all;
  });
}

export function isDesignDirty(tabId: string): boolean {
  const s = designOf(tabId);
  return !!s && JSON.stringify(s.design) !== s.base;
}

function syncDirty(tabId: string): void {
  const tab = tabOf(tabId);
  const dirty = isDesignDirty(tabId);
  if (tab && tab.dirty !== dirty) wb().update(tabId, { dirty });
}

function revalidate(tabId: string, s: DesignState): DesignState {
  const issues = validateDesign(engineOf(tabId), s.design, !!tabOf(tabId)?.newTable);
  return { ...s, issues, error: null };
}

function initial(tabId: string, name: string, source: ColumnInfo[]): DesignState {
  const tab = tabOf(tabId);
  const engine = engineOf(tabId);
  const columns = tab?.newTable
    ? [
        newDesignColumn(engine, nextKey(), {
          name: 'id',
          type:
            engine === 'mariadb' || engine === 'sqlserver'
              ? 'int'
              : engine === 'sqlite'
                ? 'INTEGER'
                : 'integer',
          nullable: false,
          primaryKey: true,
          autoIncrement: true,
        }),
      ]
    : source.map((c) => columnFromInfo(nextKey(), c));
  const design: TableDesign = { name, columns };
  const issues = validateDesign(engine, design, !!tab?.newTable);
  return {
    design,
    base: JSON.stringify(design),
    source,
    issues,
    showIssues: false,
    error: null,
    saving: false,
  };
}

/** Lee la estructura de la tabla (o arma la tabla nueva) la primera vez que se muestra la pestaña. */
export async function loadDesign(tabId: string, options: { force?: boolean } = {}): Promise<void> {
  const tab = tabOf(tabId);
  if (!tab?.object || !tab.connectionId) return;
  if (designOf(tabId) && !options.force) return;
  let source: ColumnInfo[] = [];
  if (!tab.newTable) {
    invalidateDetails(tab.connectionId, tab.object);
    source = (await tableDetails(tab.connectionId, tab.object)).columns;
  }
  useDesignStore.setState((all) => ({
    byTab: { ...all.byTab, [tabId]: initial(tabId, tab.newTable ? '' : tab.object!.name, source) },
  }));
  syncDirty(tabId);
}

export function forgetDesign(tabId: string): void {
  useDesignStore.setState((all) => ({ byTab: withoutKey(all.byTab, tabId) }));
}

export function discardDesign(tabId: string): void {
  const s = designOf(tabId);
  const tab = tabOf(tabId);
  if (!s || !tab?.object) return;
  useDesignStore.setState((all) => ({
    byTab: { ...all.byTab, [tabId]: initial(tabId, tab.newTable ? '' : tab.object!.name, s.source) },
  }));
  syncDirty(tabId);
}

function edit(tabId: string, change: (design: TableDesign) => TableDesign): void {
  put(tabId, (s) => revalidate(tabId, { ...s, design: change(s.design) }));
  syncDirty(tabId);
}

export function setTableName(tabId: string, name: string): void {
  edit(tabId, (d) => ({ ...d, name }));
  if (tabOf(tabId)?.newTable) wb().update(tabId, { title: name.trim() || es.objects.newTableTitle });
}

export function patchColumn(tabId: string, key: string, patch: Partial<DesignColumn>): void {
  edit(tabId, (d) => ({ ...d, columns: d.columns.map((c) => (c.key === key ? { ...c, ...patch } : c)) }));
}

export function addColumn(tabId: string): void {
  const engine = engineOf(tabId);
  edit(tabId, (d) => ({ ...d, columns: [...d.columns, newDesignColumn(engine, nextKey())] }));
}

/** Quita una columna nueva; una existente se marca (o desmarca) para eliminar al guardar. */
export function removeColumn(tabId: string, key: string): void {
  edit(tabId, (d) => ({
    ...d,
    columns: d.columns.flatMap((c) =>
      c.key !== key ? [c] : c.original ? [{ ...c, deleted: !c.deleted }] : [],
    ),
  }));
}

export function moveColumn(tabId: string, key: string, delta: -1 | 1): void {
  edit(tabId, (d) => {
    const from = d.columns.findIndex((c) => c.key === key);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= d.columns.length) return d;
    const columns = [...d.columns];
    [columns[from], columns[to]] = [columns[to]!, columns[from]!];
    return { ...d, columns };
  });
}

/** Sentencias pendientes del diseño actual (vacío si no hay cambios o el borrador no es válido). */
export function pendingStatements(tabId: string): string[] {
  const s = designOf(tabId);
  const tab = tabOf(tabId);
  const conn = connectionById(tab?.connectionId);
  if (!s || !tab?.object || !conn || s.issues.length > 0) return [];
  return tab.newTable
    ? buildCreateStatements(conn.engine, tab.object.schema, s.design)
    : buildAlterStatements(conn.engine, tab.object.schema, tab.object.name, s.design);
}

function previewSql(statements: string[], language: string): Promise<boolean> {
  return new Promise((resolve) => {
    useOverlayStore.getState().openDialog({ id: 'sqlPreview', statements, language, onResult: resolve });
  });
}

/** Muestra el SQL, pide confirmación (siempre en Producción) y lo aplica. Devuelve `true` si quedó guardado. */
export async function saveDesign(tabId: string): Promise<boolean> {
  const s = designOf(tabId);
  const tab = tabOf(tabId);
  const conn = connectionById(tab?.connectionId);
  if (!s || !tab?.object || !conn || s.saving) return false;
  put(tabId, (x) => ({ ...x, showIssues: true }));
  if (s.issues.length > 0) return false;
  if (conn.readOnly) {
    put(tabId, (x) => ({ ...x, error: es.dbAdmin.readOnly }));
    return false;
  }
  const statements = pendingStatements(tabId);
  if (statements.length === 0) return false;
  const language = languageFor(conn.engine);
  if (!(await previewSql(statements, language))) return false;
  if (conn.environment === 'prod' || conn.confirmWrites) {
    const answer = await askWriteConfirm({
      connectionName: conn.name,
      production: conn.environment === 'prod',
      statements,
      unbounded: false,
      language,
      allowSkip: false,
    });
    if (!answer.confirmed) return false;
  }
  if (!(await ensureConnected(conn.id))) return false;

  put(tabId, (x) => ({ ...x, saving: true, error: null }));
  const sessionId = `estructura:${crypto.randomUUID()}`;
  const { database, schema } = tab.object;
  try {
    const r = await window.api.data.apply({
      sessionId,
      connectionId: conn.id,
      database,
      schema,
      autoCommit: true,
      statements: statements.map((sql) => ({ sql, params: [], types: [], expectOne: false })),
    });
    const message = !r.ok ? r.error.message : !r.data.ok ? r.data.message : null;
    if (message !== null) {
      put(tabId, (x) => ({ ...x, saving: false, error: message }));
      return false;
    }
  } finally {
    void window.api.query.closeSession({ sessionId });
  }

  const name = s.design.name.trim() || tab.object.name;
  invalidateDetails(conn.id);
  void useConnectionsStore
    .getState()
    .loadChildren(conn.id, { kind: 'objectFolder', database, schema, objectKind: 'table' }, true);
  if (tab.newTable) {
    showToast('success', es.objects.tableCreated(name));
    forgetDesign(tabId);
    wb().remove([tabId], { remember: false });
    openObjectTab(conn.id, { database, schema, name, kind: 'table' }, 'structure', { preview: false });
  } else {
    showToast('success', es.objects.tableChanged(name));
    await loadDesign(tabId, { force: true });
  }
  return true;
}

/** Antes de cerrar pestañas: si hay cambios de estructura sin guardar, pregunta si se descartan. */
export async function confirmDiscardDesign(ids: readonly string[]): Promise<boolean> {
  for (const id of ids) {
    if (!isDesignDirty(id)) continue;
    wb().activate(id);
    const answer = await askChoice({
      title: es.objects.discardTitle,
      message: es.objects.discardMessage(tabOf(id)?.title ?? ''),
      buttons: [
        { value: 'discard', label: es.objects.discard, variant: 'danger' },
        { value: 'cancel', label: es.dialogs.cancel },
      ],
    });
    if (answer !== 'discard') return false;
  }
  return true;
}
