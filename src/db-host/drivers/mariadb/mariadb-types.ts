import type { FieldPacket } from 'mysql2';
import type { CellValue, LogicalType, ResultColumn } from '@shared/query';
import { hexText } from '../common';

/** Nombres de tipo del protocolo de MySQL por número (`mysql2` los expone en `Types`). */
const TYPE_NAMES: Record<number, string> = {
  0: 'DECIMAL',
  1: 'TINY',
  2: 'SHORT',
  3: 'LONG',
  4: 'FLOAT',
  5: 'DOUBLE',
  6: 'NULL',
  7: 'TIMESTAMP',
  8: 'LONGLONG',
  9: 'INT24',
  10: 'DATE',
  11: 'TIME',
  12: 'DATETIME',
  13: 'YEAR',
  14: 'NEWDATE',
  15: 'VARCHAR',
  16: 'BIT',
  245: 'JSON',
  246: 'NEWDECIMAL',
  247: 'ENUM',
  248: 'SET',
  249: 'TINY_BLOB',
  250: 'MEDIUM_BLOB',
  251: 'LONG_BLOB',
  252: 'BLOB',
  253: 'VAR_STRING',
  254: 'STRING',
  255: 'GEOMETRY',
};

const PRI_KEY_FLAG = 2;
const UNSIGNED_FLAG = 32;
/** Juego de caracteres `binary`: columnas BLOB/BINARY/VARBINARY (no texto). */
const BINARY_CHARSET = 63;

const STRING_TYPES = new Set(['VARCHAR', 'VAR_STRING', 'STRING', 'TINY_BLOB', 'MEDIUM_BLOB', 'LONG_BLOB', 'BLOB', 'GEOMETRY']);

/** Campo tal como lo recibe `typeCast` (el objeto real es la definición de columna completa). */
interface CastField {
  type: string;
  length: number;
  characterSet?: number;
  string(): string | null;
  buffer(): Buffer | null;
}

/**
 * Conversión de valores (opción `typeCast` de `mysql2`): enteros de hasta 32
 * bits como número, BIT(1) como booleano, binarios como `0x…` y todo lo
 * demás (decimales, BIGINT, fechas, JSON, flotantes) como texto crudo del
 * servidor, sin pérdida de precisión ni cambio de zona.
 */
export function typeCast(field: CastField, next: () => unknown): unknown {
  void next;
  switch (field.type) {
    case 'TINY':
    case 'SHORT':
    case 'LONG':
    case 'INT24':
    case 'YEAR': {
      const text = field.string();
      return text === null ? null : Number(text);
    }
    case 'BIT': {
      const bytes = field.buffer();
      if (!bytes) return null;
      if (field.length === 1) return bytes[0] === 1;
      let value = 0n;
      for (const b of bytes) value = (value << 8n) | BigInt(b);
      return value.toString();
    }
    default:
      if (STRING_TYPES.has(field.type) && field.characterSet === BINARY_CHARSET) {
        const bytes = field.buffer();
        return bytes ? hexText(bytes) : null;
      }
      return field.string();
  }
}

export function toCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Buffer.isBuffer(value)) return hexText(value);
  return String(value);
}

function typeName(f: FieldPacket): string {
  return TYPE_NAMES[f.columnType ?? f.type ?? -1] ?? 'UNKNOWN';
}

function isBinary(f: FieldPacket): boolean {
  return (f.characterSet ?? f.charsetNr) === BINARY_CHARSET;
}

function flags(f: FieldPacket): number {
  return typeof f.flags === 'number' ? f.flags : 0;
}

export function logicalTypeOf(f: FieldPacket): LogicalType {
  if (f.extendedTypeName === 'uuid') return 'uuid';
  if (f.extendedFormat === 'json') return 'json';
  switch (typeName(f)) {
    case 'DECIMAL':
    case 'NEWDECIMAL':
      return 'decimal';
    case 'TINY':
    case 'SHORT':
    case 'LONG':
    case 'INT24':
    case 'LONGLONG':
    case 'YEAR':
      return 'integer';
    case 'FLOAT':
    case 'DOUBLE':
      return 'float';
    case 'DATE':
    case 'NEWDATE':
      return 'date';
    case 'TIME':
      return 'time';
    case 'DATETIME':
    case 'TIMESTAMP':
      return 'datetime';
    case 'JSON':
      return 'json';
    case 'BIT':
      return f.columnLength === 1 ? 'boolean' : 'integer';
    case 'VARCHAR':
    case 'VAR_STRING':
    case 'STRING':
    case 'TINY_BLOB':
    case 'MEDIUM_BLOB':
    case 'LONG_BLOB':
    case 'BLOB':
      return isBinary(f) ? 'binary' : 'text';
    case 'ENUM':
    case 'SET':
      return 'text';
    case 'GEOMETRY':
      return 'binary';
    default:
      return 'other';
  }
}

/** Tipo nativo aproximado a partir de la definición de columna del protocolo. */
export function nativeTypeOf(f: FieldPacket): string {
  if (f.extendedTypeName) return f.extendedTypeName;
  const unsigned = (flags(f) & UNSIGNED_FLAG) !== 0 ? ' unsigned' : '';
  const length = f.columnLength ?? 0;
  const binary = isBinary(f);
  switch (typeName(f)) {
    case 'TINY':
      return `tinyint${unsigned}`;
    case 'SHORT':
      return `smallint${unsigned}`;
    case 'LONG':
      return `int${unsigned}`;
    case 'INT24':
      return `mediumint${unsigned}`;
    case 'LONGLONG':
      return `bigint${unsigned}`;
    case 'NEWDECIMAL':
    case 'DECIMAL': {
      const precision = length - (f.decimals > 0 ? 1 : 0) - (unsigned ? 0 : 1);
      return `decimal(${precision},${f.decimals})${unsigned}`;
    }
    case 'FLOAT':
      return 'float';
    case 'DOUBLE':
      return 'double';
    case 'BIT':
      return `bit(${length})`;
    case 'VAR_STRING':
    case 'VARCHAR':
      return binary ? 'varbinary' : 'varchar';
    case 'STRING':
      return binary ? 'binary' : 'char';
    case 'TINY_BLOB':
    case 'MEDIUM_BLOB':
    case 'LONG_BLOB':
    case 'BLOB':
      return binary ? 'blob' : 'text';
    case 'NEWDATE':
      return 'date';
    default:
      return typeName(f).toLowerCase();
  }
}

export function describeFields(fields: FieldPacket[]): ResultColumn[] {
  return fields.map((f) => {
    const sourced = !!f.orgTable;
    return {
      name: f.name,
      nativeType: nativeTypeOf(f),
      logicalType: logicalTypeOf(f),
      sourceSchema: sourced ? (f.schema ?? f.db) : undefined,
      sourceTable: sourced ? f.orgTable : undefined,
      sourceColumn: sourced ? f.orgName : undefined,
      isPk: sourced ? (flags(f) & PRI_KEY_FLAG) !== 0 : undefined,
    };
  });
}
