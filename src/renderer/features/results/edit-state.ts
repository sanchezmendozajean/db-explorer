import type { Engine } from '@shared/connection';
import type { EditOperation, EditTable } from '@shared/data-edit';
import type { CellValue, ResultColumn } from '@shared/query';
import { withoutKey } from '@shared/records';

/**
 * Cambios pendientes de la edición en grilla (specs/06 §Edición de datos):
 * celdas editadas, filas nuevas y filas marcadas para eliminar, con deshacer.
 * Funciones puras sobre el estado; el store guarda el resultado.
 */

/** Fila de la grilla: una cargada (índice en `rows`) o una nueva sin guardar. */
export type RowRef = { kind: 'row'; index: number } | { kind: 'new'; id: number };

export interface InsertedRow {
  id: number;
  /** Columnas con valor; las que faltan quedan con su valor por defecto (`DEFAULT`). */
  values: Record<number, CellValue>;
}

type UndoEntry =
  | { kind: 'cells'; cells: { ref: RowRef; column: number; previous: CellValue | undefined }[] }
  | { kind: 'insert'; ids: number[] }
  | { kind: 'delete'; rows: number[]; removed: InsertedRow[] };

export interface PendingChanges {
  /** Fila cargada → columna → valor nuevo. */
  updates: Record<number, Record<number, CellValue>>;
  deleted: number[];
  inserted: InsertedRow[];
  /** Error del último guardado por fila (`rowKey`). */
  errors: Record<string, string>;
  undo: UndoEntry[];
}

export const NO_CHANGES: PendingChanges = { updates: {}, deleted: [], inserted: [], errors: {}, undo: [] };

/** Tabla de origen de un resultado editable. */
export interface EditableInfo {
  engine: Engine;
  table: { database: string; schema: string; name: string };
  /** Por columna del resultado: su nombre en la tabla, o `null` si no se puede editar (expresiones). */
  columnNames: (string | null)[];
  /** Columnas del resultado que forman la clave (PK o índice único no nulo). */
  keyColumns: number[];
}

export function rowKey(ref: RowRef): string {
  return ref.kind === 'row' ? `r${ref.index}` : `n${ref.id}`;
}

let nextInsertId = 1;

/** Valor de una celda con los cambios aplicados; `undefined` = fila nueva con valor por defecto. */
export function cellValue(
  rows: readonly CellValue[][],
  pending: PendingChanges,
  ref: RowRef,
  column: number,
): CellValue | undefined {
  if (ref.kind === 'new') {
    const row = pending.inserted.find((r) => r.id === ref.id);
    return row && column in row.values ? row.values[column] : undefined;
  }
  const changed = pending.updates[ref.index];
  if (changed && column in changed) return changed[column]!;
  return rows[ref.index]?.[column] ?? null;
}

export function isCellEdited(pending: PendingChanges, ref: RowRef, column: number): boolean {
  if (ref.kind === 'new') return false;
  const changed = pending.updates[ref.index];
  return !!changed && column in changed;
}

function sameValue(a: CellValue | undefined, b: CellValue | undefined): boolean {
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  return String(a) === String(b);
}

/** Cambio de una celda en `updates` (`undefined` lo quita); la fila sin cambios desaparece. */
function withCell(
  updates: PendingChanges['updates'],
  row: number,
  column: number,
  value: CellValue | undefined,
): PendingChanges['updates'] {
  const base = updates[row] ?? {};
  const changed = value === undefined ? withoutKey(base, column) : { ...base, [column]: value };
  return Object.keys(changed).length > 0 ? { ...updates, [row]: changed } : withoutKey(updates, row);
}

/** Cambia celdas (editar, vaciar, NULL, pegar). Un valor igual al original quita el cambio. */
export function setCells(
  rows: readonly CellValue[][],
  pending: PendingChanges,
  cells: readonly { ref: RowRef; column: number; value: CellValue }[],
): PendingChanges {
  let updates = pending.updates;
  const inserted = pending.inserted.map((r) => ({ ...r, values: { ...r.values } }));
  const undo: UndoEntry = { kind: 'cells', cells: [] };
  for (const { ref, column, value } of cells) {
    const previous = cellValue(rows, { ...pending, updates, inserted }, ref, column);
    if (sameValue(previous, value)) continue;
    undo.cells.push({
      ref,
      column,
      previous: isCellEdited(pending, ref, column) || ref.kind === 'new' ? previous : undefined,
    });
    if (ref.kind === 'new') {
      const row = inserted.find((r) => r.id === ref.id);
      if (row) row.values[column] = value;
      continue;
    }
    const original = rows[ref.index]?.[column] ?? null;
    updates = withCell(updates, ref.index, column, sameValue(original, value) ? undefined : value);
  }
  if (undo.cells.length === 0) return pending;
  return { ...pending, updates, inserted, undo: [...pending.undo, undo] };
}

/** Agrega filas nuevas (vacías o con los valores dados) al final. */
export function addRows(
  pending: PendingChanges,
  values: readonly Record<number, CellValue>[] = [{}],
): { pending: PendingChanges; ids: number[] } {
  const rows = values.map((v) => ({ id: nextInsertId++, values: { ...v } }));
  const ids = rows.map((r) => r.id);
  return {
    pending: {
      ...pending,
      inserted: [...pending.inserted, ...rows],
      undo: [...pending.undo, { kind: 'insert', ids }],
    },
    ids,
  };
}

/** Marca filas cargadas para eliminar; las filas nuevas se quitan directamente. */
export function deleteRows(pending: PendingChanges, refs: readonly RowRef[]): PendingChanges {
  const rows = refs.flatMap((r) => (r.kind === 'row' && !pending.deleted.includes(r.index) ? [r.index] : []));
  const newIds = new Set(refs.flatMap((r) => (r.kind === 'new' ? [r.id] : [])));
  const removed = pending.inserted.filter((r) => newIds.has(r.id));
  if (rows.length === 0 && removed.length === 0) return pending;
  return {
    ...pending,
    deleted: [...pending.deleted, ...rows],
    inserted: pending.inserted.filter((r) => !newIds.has(r.id)),
    undo: [...pending.undo, { kind: 'delete', rows, removed }],
  };
}

/** Deshace el último cambio (Ctrl+Z con foco en la grilla). */
export function undoLast(pending: PendingChanges): PendingChanges {
  const last = pending.undo.at(-1);
  if (!last) return pending;
  const base = { ...pending, undo: pending.undo.slice(0, -1) };
  if (last.kind === 'insert') {
    return { ...base, inserted: base.inserted.filter((r) => !last.ids.includes(r.id)) };
  }
  if (last.kind === 'delete') {
    return {
      ...base,
      deleted: base.deleted.filter((i) => !last.rows.includes(i)),
      inserted: [...base.inserted, ...last.removed].sort((a, b) => a.id - b.id),
    };
  }
  let updates = base.updates;
  const inserted = base.inserted.map((r) => ({ ...r, values: { ...r.values } }));
  for (const { ref, column, previous } of [...last.cells].reverse()) {
    if (ref.kind === 'new') {
      const row = inserted.find((r) => r.id === ref.id);
      if (!row) continue;
      row.values =
        previous === undefined ? withoutKey(row.values, column) : { ...row.values, [column]: previous };
      continue;
    }
    updates = withCell(updates, ref.index, column, previous);
  }
  return { ...base, updates, inserted };
}

/** Filas con cambios: editadas (que no se eliminan), nuevas y eliminadas ("Guardar (n)"). */
export function pendingCount(pending: PendingChanges): number {
  const edited = Object.keys(pending.updates).filter((r) => !pending.deleted.includes(Number(r))).length;
  return edited + pending.inserted.length + pending.deleted.length;
}

/** Tabla y operaciones a guardar (eliminaciones, ediciones, inserciones), con la fila de cada una. */
export function buildOperations(
  info: EditableInfo,
  columns: readonly ResultColumn[],
  rows: readonly CellValue[][],
  pending: PendingChanges,
): { table: EditTable; operations: EditOperation[]; refs: RowRef[] } {
  // Columnas de la tabla presentes en el resultado: índice del resultado → índice en `table.columns`.
  const editIndex = new Map<number, number>();
  const tableColumns: EditTable['columns'] = [];
  info.columnNames.forEach((name, i) => {
    if (name === null) return;
    editIndex.set(i, tableColumns.length);
    tableColumns.push({ name, type: columns[i]!.logicalType });
  });
  const table: EditTable = {
    engine: info.engine,
    schema: info.engine === 'sqlite' ? undefined : info.table.schema,
    name: info.table.name,
    columns: tableColumns,
    keyColumns: info.keyColumns.map((c) => editIndex.get(c)!),
  };
  const keyOf = (index: number): CellValue[] => info.keyColumns.map((c) => rows[index]?.[c] ?? null);
  const operations: EditOperation[] = [];
  const refs: RowRef[] = [];
  for (const index of [...pending.deleted].sort((a, b) => a - b)) {
    operations.push({ kind: 'delete', key: keyOf(index) });
    refs.push({ kind: 'row', index });
  }
  for (const [row, changed] of Object.entries(pending.updates)) {
    const index = Number(row);
    if (pending.deleted.includes(index)) continue;
    const changes = Object.entries(changed)
      .filter(([c]) => editIndex.has(Number(c)))
      .map(([c, value]) => ({ column: editIndex.get(Number(c))!, value }));
    if (changes.length === 0) continue;
    operations.push({ kind: 'update', key: keyOf(index), changes });
    refs.push({ kind: 'row', index });
  }
  for (const row of pending.inserted) {
    const values = Object.entries(row.values)
      .filter(([c]) => editIndex.has(Number(c)))
      .map(([c, value]) => ({ column: editIndex.get(Number(c))!, value }));
    operations.push({ kind: 'insert', values });
    refs.push({ kind: 'new', id: row.id });
  }
  return { table, operations, refs };
}

/**
 * Filas del resultado tras guardar: ediciones aplicadas, eliminadas fuera y
 * nuevas al final (las columnas sin valor quedan en NULL hasta re-ejecutar).
 */
export function applySaved(
  rows: readonly CellValue[][],
  columnCount: number,
  pending: PendingChanges,
): CellValue[][] {
  const deleted = new Set(pending.deleted);
  const result: CellValue[][] = [];
  rows.forEach((row, index) => {
    if (deleted.has(index)) return;
    const changed = pending.updates[index];
    result.push(changed ? row.map((v, c) => (c in changed ? changed[c]! : v)) : row);
  });
  for (const r of pending.inserted) {
    result.push(Array.from({ length: columnCount }, (_, c) => (c in r.values ? r.values[c]! : null)));
  }
  return result;
}
