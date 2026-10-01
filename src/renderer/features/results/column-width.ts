import type { CellValue, ResultColumn } from '@shared/query';

/** Filas que se miden para calcular el ancho (las primeras del resultado). */
export const WIDTH_SAMPLE_ROWS = 100;
export const MIN_COLUMN_WIDTH = 60;
export const MAX_COLUMN_WIDTH = 400;
/** Relleno de la celda (8 px por lado) más un margen para que no quede justo. */
const CELL_PADDING = 22;
/** Cabecera: ícono del tipo (16 + 6) y botón de orden (24) además del relleno. */
const HEADER_EXTRA = 62;

/** Mide el ancho en píxeles de un texto con la fuente de la celda o de la cabecera. */
export type MeasureText = (text: string, header: boolean) => number;

/**
 * Ancho inicial de una columna según su contenido: el mayor entre la
 * cabecera y los textos ya formateados de las primeras filas, dentro de
 * [MIN, MAX]. Así un decimal largo con separadores no queda recortado.
 */
export function contentWidth(
  column: ResultColumn,
  index: number,
  rows: readonly CellValue[][],
  format: (value: CellValue, column: ResultColumn) => string,
  measure: MeasureText,
): number {
  let width = measure(column.name, true) + HEADER_EXTRA;
  const sample = Math.min(rows.length, WIDTH_SAMPLE_ROWS);
  for (let r = 0; r < sample; r++) {
    const text = format(rows[r]![index] ?? null, column);
    // Solo la primera línea cuenta (los saltos de línea no se dibujan en la celda).
    const line = text.length > 200 ? text.slice(0, 200) : text.split('\n', 1)[0]!;
    width = Math.max(width, measure(line, false) + CELL_PADDING);
    if (width >= MAX_COLUMN_WIDTH) break;
  }
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)));
}

/** Medidor con un canvas fuera de pantalla y la misma fuente que la grilla. */
export function canvasMeasure(fontFamily: string, fontSize: number): MeasureText {
  const ctx = document.createElement('canvas').getContext('2d');
  const cache = new Map<string, number>();
  return (text, header) => {
    if (!ctx) return text.length * fontSize * 0.62;
    const key = `${header ? 'h' : 'c'}${text}`;
    let width = cache.get(key);
    if (width === undefined) {
      ctx.font = `${header ? '600 ' : ''}${fontSize}px ${fontFamily}`;
      width = ctx.measureText(text).width;
      cache.set(key, width);
    }
    return width;
  };
}
