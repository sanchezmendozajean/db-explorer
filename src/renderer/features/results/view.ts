import type { CellValue, ResultColumn } from '@shared/query';
import type { ResultView } from './results-store';
import { isNumericType } from './format';

const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

function compareValues(a: CellValue, b: CellValue, numeric: boolean): number {
  // NULL siempre al final, en ambos sentidos.
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  if (numeric) {
    const diff = Number(a) - Number(b);
    if (diff !== 0 && !Number.isNaN(diff)) return diff;
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

/**
 * Índices de las filas visibles tras el filtro rápido y el orden (en cliente,
 * sobre lo cargado; specs/06). `null` = todas las filas en su orden original.
 */
export function visibleRows(
  rows: readonly CellValue[][],
  columns: readonly ResultColumn[],
  view: ResultView,
): number[] | null {
  const query = view.filter.trim().toLowerCase();
  const valueFilters = view.valueFilters ?? [];
  if (!query && !view.sort && valueFilters.length === 0) return null;
  let indices = Array.from({ length: rows.length }, (_, i) => i);
  if (valueFilters.length > 0) {
    indices = indices.filter((i) =>
      valueFilters.every((f) => sameCell(rows[i]![f.column] ?? null, f.value) !== f.exclude),
    );
  }
  if (query) {
    indices = indices.filter((i) =>
      rows[i]!.some(
        (v, c) => v !== null && !view.hidden.includes(c) && String(v).toLowerCase().includes(query),
      ),
    );
  }
  const sort = view.sort;
  if (sort && sort.column < columns.length) {
    const numeric = isNumericType(columns[sort.column]!.logicalType);
    const sign = sort.dir === 'asc' ? 1 : -1;
    indices.sort((x, y) => {
      const a = rows[x]![sort.column]!;
      const b = rows[y]![sort.column]!;
      const nulls = a === null || b === null;
      const cmp = compareValues(a, b, numeric);
      return (nulls ? cmp : cmp * sign) || x - y;
    });
  }
  return indices;
}

function sameCell(a: CellValue, b: CellValue): boolean {
  if (a === null || b === null) return a === b;
  return String(a) === String(b);
}

/** Columnas visibles (índices del result set) en su orden. */
export function visibleColumns(columns: readonly ResultColumn[], view: ResultView): number[] {
  return columns.map((_, i) => i).filter((i) => !view.hidden.includes(i));
}
