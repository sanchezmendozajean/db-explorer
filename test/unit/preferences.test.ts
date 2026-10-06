import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { intInRange, matchesSearch } from '../../src/renderer/features/preferences/pref-search';
import {
  formatCell,
  withColumnFormat,
  withConnectionFormat,
} from '../../src/renderer/features/results/format';

describe('buscador de Preferencias', () => {
  it('busca todas las palabras, sin tildes ni mayúsculas', () => {
    const texts = ['Separador decimal', 'Separadores de miles y de decimales.', 'Formatos de datos'];
    expect(matchesSearch('separador DECIMAL', texts)).toBe(true);
    expect(matchesSearch('  ', texts)).toBe(true);
    expect(matchesSearch('decimal fecha', texts)).toBe(false);
    expect(matchesSearch('tabulacion', ['Tabulación'])).toBe(true);
  });

  it('valida enteros dentro de un rango', () => {
    expect(intInRange('10', 1, 60)).toBe(10);
    expect(intInRange('0', 1, 60)).toBeNull();
    expect(intInRange('2.5', 1, 60)).toBeNull();
    expect(intInRange('', 1, 60)).toBeNull();
  });
});

describe('formato por conexión (specs/06, nivel 2)', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    'format.connections': { pg: { 'float.maxDigits': 3, boolean: '1/0' as const } },
  };

  it('la conexión cambia solo lo que define; la columna va encima', () => {
    const conn = withConnectionFormat(settings, 'pg');
    expect(formatCell(3.14159265, 'float', conn)).toBe('3.14');
    expect(formatCell(true, 'boolean', conn)).toBe('1');
    expect(formatCell('1234.5', 'decimal', conn)).toBe('1,234.5');
    expect(formatCell(3.14159265, 'float', withConnectionFormat(settings, 'otra'))).toBe('3.14159265');
    expect(formatCell(3.14159265, 'float', withColumnFormat(conn, { 'float.maxDigits': 5 }))).toBe('3.1416');
    expect(withConnectionFormat(settings, undefined)).toBe(settings);
  });
});
