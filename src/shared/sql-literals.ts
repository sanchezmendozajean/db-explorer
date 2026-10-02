import type { Engine } from './connection';
import type { CellValue, LogicalType } from './query';

/**
 * Literales SQL por dialecto, para "Ver SQL" de la edición en grilla, copiar
 * como `INSERT` o lista `IN (…)` y exportar a SQL (specs/06).
 */

const NUMERIC = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const NUMERIC_TYPES: LogicalType[] = ['integer', 'decimal', 'float'];

/** Cadena entre comillas simples; MariaDB además escapa la barra invertida. */
export function stringLiteral(engine: Engine, text: string): string {
  let body = text.replace(/'/g, "''");
  if (engine === 'mariadb') body = body.replace(/\\/g, '\\\\');
  return engine === 'sqlserver' ? `N'${body}'` : `'${body}'`;
}

/** Hexadecimal de un binario tal como lo muestra la grilla (`0x…` o `\x…`). */
function hexOf(text: string): string | null {
  const m = /^(?:0x|\\x)([0-9a-f]*)$/i.exec(text.trim());
  return m && m[1]!.length % 2 === 0 ? m[1]!.toUpperCase() : null;
}

export function sqlLiteral(engine: Engine, value: CellValue, type: LogicalType): string {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') {
    if (engine === 'postgres') return value ? 'TRUE' : 'FALSE';
    return value ? '1' : '0';
  }
  if (typeof value === 'number') return String(value);
  if (NUMERIC_TYPES.includes(type) && NUMERIC.test(value.trim())) return value.trim();
  if (type === 'binary') {
    const hex = hexOf(value);
    if (hex !== null) {
      if (engine === 'postgres') return `'\\x${hex.toLowerCase()}'::bytea`;
      if (engine === 'sqlserver') return `0x${hex}`;
      return `X'${hex}'`;
    }
  }
  if (type === 'boolean' && engine === 'postgres' && /^(t|f|true|false)$/i.test(value)) {
    return /^t/i.test(value) ? 'TRUE' : 'FALSE';
  }
  return stringLiteral(engine, value);
}
