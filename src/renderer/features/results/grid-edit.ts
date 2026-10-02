import { buildStatements } from '@shared/data-edit';
import type { CellValue } from '@shared/query';
import { es } from '../../i18n/es';
import { connectionById } from '../../stores/connections-store';
import { showToast } from '../../stores/toast-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import type { EditorTab } from '../../stores/workbench-store';
import { ensureConnected } from '../connections/actions';
import { askChoice, askSqlPreview, askWriteConfirm } from '../dialogs/ask';
import { languageFor } from '../editor/documents';
import { addPendingStatements, isManual } from '../execution/transactions';
import type { PendingChanges, RowRef } from './edit-state';
import { applySaved, buildOperations, NO_CHANGES, pendingCount, rowKey } from './edit-state';
import type { ResultSet } from './results-store';
import { addMessage, tabResults, updateResult } from './results-store';

/**
 * Acciones de edición en grilla (specs/06 §Edición de datos): cambios
 * pendientes, deshacer, guardar en una transacción y "Ver SQL".
 */

/** Grilla con foco: los atajos de edición (Supr, Alt+Insert, Ctrl+Z…) actúan sobre ella. */
export interface GridHandle {
  tabId: string;
  resultId: string;
  /** Filas con alguna celda seleccionada (o la de la celda con foco). */
  selectedRows: () => RowRef[];
  /** Celdas seleccionadas (columna = índice en el resultado). */
  selectedCells: () => { ref: RowRef; column: number }[];
  /** Celda con foco (para pegar). */
  focusedCell: () => { displayRow: number; column: number } | null;
  /** Fila de la grilla → fila del resultado, y columnas visibles en orden. */
  refAt: (displayRow: number) => RowRef | null;
  visibleColumns: () => number[];
  /** Selecciona la celda (fila visible, columna visible) y la muestra. */
  focusCell: (displayRow: number, visibleColumn: number) => void;
}

let activeGrid: GridHandle | null = null;

export function setActiveGrid(handle: GridHandle | null): void {
  activeGrid = handle;
}

export function getActiveGrid(): GridHandle | null {
  return activeGrid;
}

function resultOf(tabId: string, resultId: string): ResultSet | undefined {
  return tabResults(tabId).results.find((r) => r.id === resultId);
}

function tabOf(tabId: string): EditorTab | undefined {
  return useWorkbenchStore.getState().tabs.find((t) => t.id === tabId);
}

/** Aplica un cambio a los pendientes; la pestaña deja de ser vista previa (como al editar en VS Code). */
export function editPending(
  tabId: string,
  resultId: string,
  change: (pending: PendingChanges, result: ResultSet) => PendingChanges,
): void {
  const result = resultOf(tabId, resultId);
  if (!result?.editable) return;
  const pending = change(result.pending, result);
  if (pending === result.pending) return;
  updateResult(tabId, resultId, { pending, version: result.version + 1 });
  const tab = tabOf(tabId);
  if (tab?.preview) useWorkbenchStore.getState().pin(tabId);
}

/** ¿La columna se puede editar? (las expresiones del resultado no). */
export function isEditableColumn(result: ResultSet, column: number): boolean {
  return !!result.editable && result.editable.columnNames[column] !== null;
}

/** Texto de las columnas de texto se vacía; el resto queda en NULL (Supr). */
export function emptyValueFor(result: ResultSet, column: number): CellValue {
  const type = result.columns[column]?.logicalType;
  return type === 'text' || type === 'json' || type === 'other' ? '' : null;
}

export function hasPendingChanges(tabId: string): boolean {
  return tabResults(tabId).results.some((r) => pendingCount(r.pending) > 0);
}

export function discardChanges(tabId: string, resultId: string): void {
  const result = resultOf(tabId, resultId);
  if (result) updateResult(tabId, resultId, { pending: NO_CHANGES, version: result.version + 1 });
}

/**
 * Antes de re-ejecutar o cerrar: si hay cambios sin guardar en la grilla,
 * pregunta si se descartan. Devuelve false si el usuario cancela.
 */
export async function confirmDiscardGridChanges(tabId: string): Promise<boolean> {
  if (!hasPendingChanges(tabId)) return true;
  const answer = await askChoice({
    title: es.results.edit.discardTitle,
    message: es.results.edit.discardMessage,
    buttons: [
      { value: 'discard', label: es.results.edit.discard, variant: 'danger' },
      { value: 'cancel', label: es.dialogs.cancel },
    ],
  });
  return answer === 'discard';
}

/** Sentencias con literales de los cambios pendientes ("Ver SQL"). */
export function pendingSql(result: ResultSet): string[] {
  if (!result.editable) return [];
  const { table, operations } = buildOperations(result.editable, result.columns, result.rows, result.pending);
  return buildStatements(table, operations).map((g) => g.literal);
}

/**
 * Guarda los cambios pendientes en una transacción (specs/06): con
 * `preview`, primero muestra las sentencias ("Ver SQL" → Aplicar). En
 * Producción siempre pide confirmación. Ante un error se revierte todo y la
 * fila queda marcada con el mensaje.
 */
export async function saveChanges(
  tabId: string,
  resultId: string,
  options: { preview?: boolean; onSaved?: () => void } = {},
): Promise<boolean> {
  const tab = tabOf(tabId);
  const result = resultOf(tabId, resultId);
  const conn = connectionById(tab?.connectionId);
  if (!tab || !result?.editable || !conn || pendingCount(result.pending) === 0) return false;
  const { table, operations, refs } = buildOperations(
    result.editable,
    result.columns,
    result.rows,
    result.pending,
  );
  const generated = buildStatements(table, operations);
  const literals = generated.map((g) => g.literal);
  const language = languageFor(conn.engine);
  if (options.preview && !(await askSqlPreview({ statements: literals, language }))) return false;
  if (conn.confirmWrites) {
    const answer = await askWriteConfirm({
      connectionName: conn.name,
      production: true,
      statements: literals.map((l) => l.replace(/;$/, '')),
      unbounded: false,
      language,
      allowSkip: false,
    });
    if (!answer.confirmed) return false;
  }
  if (!(await ensureConnected(conn.id))) return false;

  const manual = isManual(tabId);
  const object = tab.kind === 'object' ? tab.object : undefined;
  const r = await window.api.data.apply({
    sessionId: tabId,
    connectionId: conn.id,
    database: object ? object.database : tab.database,
    schema: object ? object.schema : tab.schema,
    autoCommit: !manual,
    statements: generated.map((g) => g.statement),
  });
  if (!r.ok) {
    showToast('error', r.error.message);
    return false;
  }
  const current = resultOf(tabId, resultId) ?? result;
  if (!r.data.ok) {
    const failed = refs[r.data.index];
    const errors = failed ? { [rowKey(failed)]: r.data.message } : {};
    updateResult(tabId, resultId, { pending: { ...current.pending, errors }, version: current.version + 1 });
    showToast('error', es.results.edit.saveFailed(r.data.message));
    addMessage(tabId, { kind: 'error', text: es.results.edit.saveFailed(r.data.message) });
    return false;
  }
  const rows = applySaved(current.rows, current.columns.length, current.pending);
  updateResult(tabId, resultId, { rows, pending: NO_CHANGES, version: current.version + 1 });
  if (manual) addPendingStatements(tabId, generated.length);
  addMessage(tabId, {
    kind: 'info',
    text: manual
      ? es.results.edit.savedPendingCommit(generated.length)
      : es.results.edit.saved(generated.length),
  });
  options.onSaved?.();
  return true;
}
