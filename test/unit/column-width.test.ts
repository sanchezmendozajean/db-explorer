import { describe, expect, it } from 'vitest';
import type { ResultColumn } from '@shared/query';
import {
  contentWidth,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
} from '../../src/renderer/features/results/column-width';

// 7 px por carácter (como una fuente monoespaciada de 12 px).
const measure = (text: string): number => text.length * 7;
const format = (v: unknown): string => (v === null ? 'NULL' : String(v));
const col = (name: string): ResultColumn => ({ name, nativeType: '', logicalType: 'decimal' });

describe('contentWidth', () => {
  it('ensancha la columna para el valor más largo de las primeras filas', () => {
    const rows = [['1.00'], ['12,345,678,901,234.123456'], ['2']];
    expect(contentWidth(col('importe'), 0, rows, format, measure)).toBe(25 * 7 + 22);
  });

  it('la cabecera manda si es más ancha que los valores', () => {
    expect(contentWidth(col('nombre_muy_largo_de_columna'), 0, [['1']], format, measure)).toBe(27 * 7 + 62);
  });

  it('respeta los límites mínimo y máximo', () => {
    expect(contentWidth(col('a'), 0, [['1']], format, () => 0)).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH);
    expect(contentWidth(col('a'), 0, [['x'.repeat(500)]], format, measure)).toBe(MAX_COLUMN_WIDTH);
  });

  it('mide solo la primera línea de un texto con saltos', () => {
    expect(contentWidth(col('t'), 0, [['corto\n' + 'x'.repeat(80)]], format, measure)).toBe(1 * 7 + 62);
  });
});
