import { describe, expect, it } from 'vitest';
import type { CellValue, ResultColumn } from '@shared/query';
import type { EditableInfo } from '../../src/renderer/features/results/edit-state';
import {
  addRows,
  applySaved,
  buildOperations,
  cellValue,
  deleteRows,
  NO_CHANGES,
  pendingCount,
  setCells,
  undoLast,
} from '../../src/renderer/features/results/edit-state';
import { parseTsv } from '../../src/renderer/features/results/copy';
import { withColumnFormat } from '../../src/renderer/features/results/format';
import { formatCell } from '../../src/renderer/features/results/format';
import { DEFAULT_SETTINGS } from '@shared/settings';

const rows: CellValue[][] = [
  [1, 'Ana', '10.50'],
  [2, 'Beto', null],
];
const columns: ResultColumn[] = [
  { name: 'id', nativeType: 'int', logicalType: 'integer' },
  { name: 'nombre', nativeType: 'text', logicalType: 'text' },
  { name: 'calc', nativeType: 'numeric', logicalType: 'decimal' },
];
const info: EditableInfo = {
  engine: 'postgres',
  table: { database: 'db', schema: 'ventas', name: 'clientes' },
  // La tercera columna es una expresión: no se edita.
  columnNames: ['id', 'nombre', null],
  keyColumns: [0],
};

describe('cambios pendientes de la grilla', () => {
  it('editar, volver al valor original y deshacer', () => {
    let p = setCells(rows, NO_CHANGES, [{ ref: { kind: 'row', index: 0 }, column: 1, value: 'Ana María' }]);
    expect(cellValue(rows, p, { kind: 'row', index: 0 }, 1)).toBe('Ana María');
    expect(pendingCount(p)).toBe(1);
    p = setCells(rows, p, [{ ref: { kind: 'row', index: 0 }, column: 1, value: 'Ana' }]);
    expect(pendingCount(p)).toBe(0);
    p = undoLast(p);
    expect(cellValue(rows, p, { kind: 'row', index: 0 }, 1)).toBe('Ana María');
    p = undoLast(p);
    expect(pendingCount(p)).toBe(0);
  });

  it('filas nuevas con DEFAULT, eliminadas y sus sentencias', () => {
    const added = addRows(NO_CHANGES);
    let p = setCells(rows, added.pending, [
      { ref: { kind: 'new', id: added.ids[0]! }, column: 1, value: 'Nuevo' },
    ]);
    expect(cellValue(rows, p, { kind: 'new', id: added.ids[0]! }, 0)).toBeUndefined();
    p = setCells(rows, p, [{ ref: { kind: 'row', index: 1 }, column: 1, value: 'Beatriz' }]);
    p = deleteRows(p, [{ kind: 'row', index: 0 }]);
    expect(pendingCount(p)).toBe(3);
    const { operations, refs, table } = buildOperations(info, columns, rows, p);
    expect(table.columns.map((c) => c.name)).toEqual(['id', 'nombre']);
    expect(operations).toEqual([
      { kind: 'delete', key: [1] },
      { kind: 'update', key: [2], changes: [{ column: 1, value: 'Beatriz' }] },
      { kind: 'insert', values: [{ column: 1, value: 'Nuevo' }] },
    ]);
    expect(refs.map((r) => r.kind)).toEqual(['row', 'row', 'new']);
    expect(applySaved(rows, 3, p)).toEqual([
      [2, 'Beatriz', null],
      [null, 'Nuevo', null],
    ]);
    // Quitar una fila nueva y deshacer la eliminación.
    p = deleteRows(p, [{ kind: 'new', id: added.ids[0]! }]);
    expect(p.inserted).toHaveLength(0);
    p = undoLast(p);
    expect(p.inserted).toHaveLength(1);
  });

  it('interpreta TSV de Excel con comillas y saltos de línea', () => {
    expect(parseTsv('a\tb\r\n"c ""d"""\t"e\nf"\r\n')).toEqual([
      ['a', 'b'],
      ['c "d"', 'e\nf'],
    ]);
  });

  it('el formato de columna pisa al global', () => {
    const s = withColumnFormat(DEFAULT_SETTINGS, { 'decimal.mode': 'fixed', 'decimal.places': 0 });
    expect(formatCell('1234.56', 'decimal', s)).toBe('1,235');
    expect(formatCell('1234.56', 'decimal', DEFAULT_SETTINGS)).toBe('1,234.56');
  });
});
