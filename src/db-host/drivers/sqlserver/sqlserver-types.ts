import type { ColumnMetadata } from 'tedious/lib/token/colmetadata-token-parser';
import type { CellValue, LogicalType } from '@shared/query';
import { hexText } from '../common';

/** Tipo lógico por el nombre de tipo TDS de `tedious` (specs/03). */
export function logicalTypeOf(meta: ColumnMetadata): LogicalType {
  switch (meta.type.name) {
    case 'TinyInt':
    case 'SmallInt':
    case 'Int':
    case 'BigInt':
    case 'IntN':
      return 'integer';
    case 'Bit':
    case 'BitN':
      return 'boolean';
    case 'Decimal':
    case 'DecimalN':
    case 'Numeric':
    case 'NumericN':
    case 'Money':
    case 'SmallMoney':
    case 'MoneyN':
      return 'decimal';
    case 'Float':
    case 'FloatN':
    case 'Real':
      return 'float';
    case 'Date':
      return 'date';
    case 'Time':
      return 'time';
    case 'DateTime':
    case 'DateTimeN':
    case 'DateTime2':
    case 'SmallDateTime':
      return 'datetime';
    case 'DateTimeOffset':
      return 'datetimetz';
    case 'UniqueIdentifier':
      return 'uuid';
    case 'Binary':
    case 'VarBinary':
    case 'Image':
      return 'binary';
    case 'Char':
    case 'VarChar':
    case 'NChar':
    case 'NVarChar':
    case 'Text':
    case 'NText':
    case 'Xml':
      return 'text';
    default:
      return 'other';
  }
}

/** Largo de un tipo de texto/binario (`max` para los de largo ilimitado). */
function length(meta: ColumnMetadata, bytesPerChar: number): string {
  const n = meta.dataLength;
  if (n === undefined || n === 0xffff || n > 8000) return 'max';
  return String(n / bytesPerChar);
}

/** Tipo nativo aproximado a partir de los metadatos TDS (si no se pudo describir el resultado). */
export function nativeTypeOf(meta: ColumnMetadata): string {
  const size = meta.dataLength;
  switch (meta.type.name) {
    case 'IntN':
      return size === 1 ? 'tinyint' : size === 2 ? 'smallint' : size === 8 ? 'bigint' : 'int';
    case 'BitN':
      return 'bit';
    case 'FloatN':
      return size === 4 ? 'real' : 'float';
    case 'MoneyN':
      return size === 4 ? 'smallmoney' : 'money';
    case 'DateTimeN':
      return size === 4 ? 'smalldatetime' : 'datetime';
    case 'DecimalN':
    case 'NumericN':
      return `${meta.type.name === 'DecimalN' ? 'decimal' : 'numeric'}(${meta.precision},${meta.scale})`;
    case 'DateTime2':
    case 'DateTimeOffset':
    case 'Time':
      return `${meta.type.name.toLowerCase()}(${meta.scale})`;
    case 'VarChar':
    case 'Char':
    case 'VarBinary':
    case 'Binary':
      return `${meta.type.name.toLowerCase()}(${length(meta, 1)})`;
    case 'NVarChar':
    case 'NChar':
      return `${meta.type.name.toLowerCase()}(${length(meta, 2)})`;
    case 'UniqueIdentifier':
      return 'uniqueidentifier';
    case 'Variant':
      return 'sql_variant';
    case 'UDT':
      return meta.udtInfo?.typeName ?? 'udt';
    default:
      return meta.type.name.toLowerCase();
  }
}

/** Valor de una celda (decimales y fechas ya llegan como texto exacto, ver `exact-values.ts`). */
export function toCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Buffer.isBuffer(value)) return hexText(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  return JSON.stringify(value);
}
