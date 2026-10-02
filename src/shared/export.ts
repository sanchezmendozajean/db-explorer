import type { Engine } from './connection';
import type { CellValue, ResultColumn } from './query';
import { quoteIdent } from './sql-quote';
import { sqlLiteral } from './sql-literals';

/**
 * Codificadores de texto para copiar como y exportar (specs/06 §Copiar y
 * exportar): CSV, TSV, JSON, Markdown e `INSERT`. Trabajan por lotes de
 * filas para poder escribir en flujo sin juntar el resultado entero.
 */

export interface RowEncoder {
  /** Texto antes de la primera fila (cabeceras, `[`). */
  begin(): string;
  /** Un lote de filas; `first` indica si es el primero (separadores de JSON). */
  rows(rows: readonly CellValue[][], first: boolean): string;
  /** Texto final (`]`). */
  end(): string;
}

/** Campo CSV con comillas dobles si contiene el separador, comillas o saltos de línea. */
export function csvField(text: string, separator: string): string {
  return text.includes(separator) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function raw(value: CellValue, nullAs: string): string {
  return value === null ? nullAs : String(value);
}

export function csvEncoder(
  columns: readonly ResultColumn[],
  options: { separator: string; header: boolean; nullAs?: string },
): RowEncoder {
  const { separator } = options;
  const nullAs = options.nullAs ?? '';
  const line = (fields: string[]): string =>
    `${fields.map((f) => csvField(f, separator)).join(separator)}\r\n`;
  return {
    begin: () => (options.header ? line(columns.map((c) => c.name)) : ''),
    rows: (rows) => rows.map((r) => line(r.map((v) => raw(v, nullAs)))).join(''),
    end: () => '',
  };
}

/** JSON: arreglo de objetos con el nombre de cada columna; decimales y fechas como texto crudo. */
export function jsonEncoder(columns: readonly ResultColumn[], options: { pretty: boolean }): RowEncoder {
  const names = uniqueNames(columns.map((c) => c.name));
  const object = (row: readonly CellValue[]): string => {
    const entries = names.map((n, i) => [n, row[i] ?? null] as const);
    return options.pretty
      ? JSON.stringify(Object.fromEntries(entries), null, 2).replace(/^/gm, '  ')
      : JSON.stringify(Object.fromEntries(entries));
  };
  const sep = options.pretty ? ',\n' : ',';
  return {
    begin: () => (options.pretty ? '[\n' : '['),
    rows: (rows, first) => (rows.length === 0 ? '' : (first ? '' : sep) + rows.map(object).join(sep)),
    end: () => (options.pretty ? '\n]\n' : ']'),
  };
}

/** Nombres repetidos (`id`, `id`) se distinguen con sufijo (`id`, `id_2`) para no perder valores en JSON. */
function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const count = (seen.get(n) ?? 0) + 1;
    seen.set(n, count);
    return count === 1 ? n : `${n}_${count}`;
  });
}

export function markdownEncoder(columns: readonly ResultColumn[], options: { nullAs: string }): RowEncoder {
  const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  const line = (fields: string[]): string => `| ${fields.map(cell).join(' | ')} |\n`;
  return {
    begin: () => line(columns.map((c) => c.name)) + line(columns.map(() => '---')),
    rows: (rows) => rows.map((r) => line(r.map((v) => raw(v, options.nullAs)))).join(''),
    end: () => '',
  };
}

/** `INSERT INTO tabla (cols) VALUES (…);` por fila, con literales del dialecto. */
export function insertEncoder(
  columns: readonly ResultColumn[],
  options: { engine: Engine; table: string },
): RowEncoder {
  const { engine } = options;
  const cols = columns.map((c) => quoteIdent(engine, c.name)).join(', ');
  const prefix = `INSERT INTO ${options.table} (${cols}) VALUES (`;
  return {
    begin: () => '',
    rows: (rows) =>
      rows
        .map(
          (r) => `${prefix}${r.map((v, i) => sqlLiteral(engine, v, columns[i]!.logicalType)).join(', ')});\n`,
        )
        .join(''),
    end: () => '',
  };
}

/** Lista `(v1, v2, …)` de los valores de una columna, sin repetidos, para `IN (…)`. */
export function inList(engine: Engine, column: ResultColumn, values: readonly CellValue[]): string {
  const literals = [
    ...new Set(values.filter((v) => v !== null).map((v) => sqlLiteral(engine, v, column.logicalType))),
  ];
  return `(${literals.join(', ')})`;
}

/** Texto completo de un encoder sobre filas ya cargadas. */
export function encodeAll(encoder: RowEncoder, rows: readonly CellValue[][]): string {
  return encoder.begin() + encoder.rows(rows, true) + encoder.end();
}
