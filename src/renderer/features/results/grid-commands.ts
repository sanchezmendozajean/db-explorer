import type { CellValue } from '@shared/query';
import { es } from '../../i18n/es';
import { showToast } from '../../stores/toast-store';
import { parseTsv } from './copy';
import type { RowRef } from './edit-state';
import { addRows, deleteRows, setCells, undoLast } from './edit-state';
import type { GridHandle } from './grid-edit';
import { editPending, emptyValueFor, getActiveGrid, isEditableColumn, saveChanges } from './grid-edit';
import type { ResultSet } from './results-store';
import { tabResults } from './results-store';

/**
 * Atajos de edición de la grilla con foco (specs/06): Supr vacía, Shift+Supr
 * NULL, Alt+Insert agrega fila, Ctrl+Supr elimina filas, Ctrl+Z deshace,
 * Ctrl+S guarda y Ctrl+V pega.
 */

function current(): { grid: GridHandle; result: ResultSet } | null {
  const grid = getActiveGrid();
  if (!grid) return null;
  const result = tabResults(grid.tabId).results.find((r) => r.id === grid.resultId);
  return result ? { grid, result } : null;
}

/** ¿Hay una grilla editable con foco? (habilita los atajos). */
export function canEditActiveGrid(): boolean {
  return !!current()?.result.editable;
}

export function hasUndo(): boolean {
  return (current()?.result.pending.undo.length ?? 0) > 0;
}

function setSelected(valueFor: (result: ResultSet, column: number) => CellValue): void {
  const c = current();
  if (!c?.result.editable) return;
  const cells = c.grid
    .selectedCells()
    .filter(({ column }) => isEditableColumn(c.result, column))
    .map(({ ref, column }) => ({ ref, column, value: valueFor(c.result, column) }));
  editPending(c.grid.tabId, c.grid.resultId, (pending, result) => setCells(result.rows, pending, cells));
}

export function clearSelectedCells(): void {
  setSelected(emptyValueFor);
}

export function setSelectedNull(): void {
  setSelected(() => null);
}

export function addRow(): void {
  const c = current();
  if (!c?.result.editable) return;
  let added: number[] = [];
  editPending(c.grid.tabId, c.grid.resultId, (pending) => {
    const r = addRows(pending);
    added = r.ids;
    return r.pending;
  });
  if (added.length > 0) focusNewRow(c.grid, added[0]!);
}

/** Copia las filas seleccionadas como filas nuevas (sin las columnas de la clave). */
export function duplicateSelectedRows(): void {
  const c = current();
  if (!c?.result.editable) return;
  const keys = new Set(c.result.editable.keyColumns);
  const editable = c.result.editable.columnNames.flatMap((n, i) => (n !== null && !keys.has(i) ? [i] : []));
  const values = c.grid.selectedRows().map((ref) => {
    const row: Record<number, CellValue> = {};
    for (const col of editable) {
      const v = valueAt(c.result, ref, col);
      if (v !== undefined) row[col] = v;
    }
    return row;
  });
  if (values.length === 0) return;
  editPending(c.grid.tabId, c.grid.resultId, (pending) => addRows(pending, values).pending);
}

export function deleteSelectedRows(): void {
  const c = current();
  if (!c?.result.editable) return;
  const refs = c.grid.selectedRows();
  editPending(c.grid.tabId, c.grid.resultId, (pending) => deleteRows(pending, refs));
}

export function undoGrid(): void {
  const c = current();
  if (!c) return;
  editPending(c.grid.tabId, c.grid.resultId, (pending) => undoLast(pending));
}

export function saveActiveGrid(): void {
  const c = current();
  if (c) void saveChanges(c.grid.tabId, c.grid.resultId);
}

function valueAt(result: ResultSet, ref: RowRef, column: number): CellValue | undefined {
  if (ref.kind === 'new') {
    const row = result.pending.inserted.find((r) => r.id === ref.id);
    return row && column in row.values ? row.values[column] : undefined;
  }
  const changed = result.pending.updates[ref.index];
  if (changed && column in changed) return changed[column];
  return result.rows[ref.index]?.[column] ?? null;
}

function focusNewRow(grid: GridHandle, id: number): void {
  // La fila nueva queda al final: se busca su posición en la grilla.
  requestAnimationFrame(() => {
    for (let row = 0; ; row++) {
      const ref = grid.refAt(row);
      if (!ref) return;
      if (ref.kind === 'new' && ref.id === id) {
        grid.focusCell(row, 0);
        return;
      }
    }
  });
}

/** Texto pegado → valor de la celda según el tipo de la columna. */
function pastedValue(result: ResultSet, column: number, text: string): CellValue {
  const type = result.columns[column]?.logicalType;
  if (text === '') return emptyValueFor(result, column);
  if (type === 'boolean') {
    if (/^(true|t|1|sí|si|yes)$/i.test(text)) return true;
    if (/^(false|f|0|no)$/i.test(text)) return false;
  }
  return text;
}

/** Pega TSV (de Excel o de la grilla) desde la celda con foco; las filas que sobran se agregan como nuevas. */
export async function pasteIntoGrid(): Promise<void> {
  const c = current();
  if (!c?.result.editable) return;
  const start = c.grid.focusedCell();
  if (!start) return;
  const r = await window.api.app.clipboardRead({});
  if (!r.ok) {
    showToast('error', r.error.message);
    return;
  }
  const matrix = parseTsv(r.data.text);
  const cols = c.grid.visibleColumns();
  const cells: { ref: RowRef; column: number; value: CellValue }[] = [];
  const extra: Record<number, CellValue>[] = [];
  matrix.forEach((line, i) => {
    const ref = c.grid.refAt(start.displayRow + i);
    const values: Record<number, CellValue> = {};
    line.forEach((text, j) => {
      const column = cols[start.column + j];
      if (column === undefined || !isEditableColumn(c.result, column)) return;
      const value = pastedValue(c.result, column, text);
      if (ref) cells.push({ ref, column, value });
      else values[column] = value;
    });
    if (!ref && Object.keys(values).length > 0) extra.push(values);
  });
  if (cells.length === 0 && extra.length === 0) {
    showToast('info', es.results.edit.nothingToPaste);
    return;
  }
  editPending(c.grid.tabId, c.grid.resultId, (pending, result) => {
    const next = cells.length > 0 ? setCells(result.rows, pending, cells) : pending;
    return extra.length > 0 ? addRows(next, extra).pending : next;
  });
}
