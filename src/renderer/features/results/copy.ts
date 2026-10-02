import type { CellValue } from '@shared/query';

/**
 * Copia de la grilla en TSV compatible con Excel (specs/06 §Copiar y exportar).
 * Trabaja en coordenadas visibles: filas ya filtradas/ordenadas y columnas
 * visibles en su orden actual.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Selección de la grilla: rangos de celdas (Ctrl+clic agrega), filas y columnas completas. */
export interface CopySelection {
  rects: Rect[];
  rows: number[];
  columns: number[];
}

export interface CopySource {
  rowCount: number;
  columnCount: number;
  header: (col: number) => string;
  value: (row: number, col: number) => CellValue;
}

export interface CopyOptions {
  headers: boolean;
  /** Texto para NULL (`results.copy.nullAs`, por defecto vacío). */
  nullAs: string;
}

/** Entrecomilla según las reglas TSV/CSV de Excel si el valor tiene tabulador, salto de línea o comillas. */
export function tsvField(text: string): string {
  return /[\t\r\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rawText(value: CellValue, nullAs: string): string {
  if (value === null) return nullAs;
  return String(value);
}

/** Filas y columnas afectadas por la selección, en orden visible. */
export function selectionBounds(
  sel: CopySelection,
  source: CopySource,
): { rows: number[]; columns: number[] } {
  const rows = new Set<number>(sel.rows);
  const columns = new Set<number>(sel.columns);
  for (const r of sel.rects) {
    for (let y = r.y; y < r.y + r.height; y++) rows.add(y);
    for (let x = r.x; x < r.x + r.width; x++) columns.add(x);
  }
  // Una fila completa aporta todas las columnas; una columna completa, todas las filas.
  if (sel.rows.length > 0) for (let x = 0; x < source.columnCount; x++) columns.add(x);
  if (sel.columns.length > 0) for (let y = 0; y < source.rowCount; y++) rows.add(y);
  const inRange = (max: number) => (n: number) => n >= 0 && n < max;
  return {
    rows: [...rows].filter(inRange(source.rowCount)).sort((a, b) => a - b),
    columns: [...columns].filter(inRange(source.columnCount)).sort((a, b) => a - b),
  };
}

export function selectedCellCount(sel: CopySelection, source: CopySource): number {
  const { rows, columns } = selectionBounds(sel, source);
  return rows.length * columns.length;
}

/** TSV de la selección: celdas no seleccionadas dentro del contorno van vacías. */
export function selectionToTsv(sel: CopySelection, source: CopySource, options: CopyOptions): string {
  const { rows, columns } = selectionBounds(sel, source);
  if (rows.length === 0 || columns.length === 0) return '';
  const fullRows = new Set(sel.rows);
  const fullColumns = new Set(sel.columns);
  const isSelected = (row: number, col: number): boolean =>
    fullRows.has(row) ||
    fullColumns.has(col) ||
    sel.rects.some((r) => col >= r.x && col < r.x + r.width && row >= r.y && row < r.y + r.height);

  // Una sola celda: solo el valor, sin tabulador ni salto de línea final.
  if (rows.length === 1 && columns.length === 1) {
    const value = rawText(source.value(rows[0]!, columns[0]!), options.nullAs);
    return options.headers ? `${tsvField(source.header(columns[0]!))}\r\n${tsvField(value)}` : value;
  }

  const lines: string[] = [];
  if (options.headers) lines.push(columns.map((c) => tsvField(source.header(c))).join('\t'));
  for (const row of rows) {
    lines.push(
      columns
        .map((col) => (isSelected(row, col) ? tsvField(rawText(source.value(row, col), options.nullAs)) : ''))
        .join('\t'),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** TSV de toda la tabla cargada ("Copiar tabla"), sin importar la selección. */
export function tableToTsv(source: CopySource, options: CopyOptions): string {
  const all: CopySelection = { rects: [], rows: [], columns: [] };
  if (source.rowCount === 0 || source.columnCount === 0) {
    return options.headers
      ? `${Array.from({ length: source.columnCount }, (_, c) => tsvField(source.header(c))).join('\t')}\r\n`
      : '';
  }
  all.rects.push({ x: 0, y: 0, width: source.columnCount, height: source.rowCount });
  if (source.rowCount === 1 && source.columnCount === 1) {
    const value = rawText(source.value(0, 0), options.nullAs);
    return options.headers
      ? `${tsvField(source.header(0))}\r\n${tsvField(value)}\r\n`
      : `${tsvField(value)}\r\n`;
  }
  return selectionToTsv(all, source, options);
}

/** Interpreta texto TSV (lo que pega Excel): comillas dobles con `""` y saltos de línea dentro. */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let quoted = false;
  const body = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  while (i < body.length) {
    const ch = body[i]!;
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') quoted = false;
      else field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === '\t') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
    i++;
  }
  row.push(field);
  rows.push(row);
  return rows;
}
