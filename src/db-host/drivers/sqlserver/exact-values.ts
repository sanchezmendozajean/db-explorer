import { createRequire } from 'node:module';

/**
 * Lectura exacta de valores de SQL Server (specs/03: "decimal/money como
 * string, datetime2 sin conversión de zona").
 *
 * `tedious` convierte `decimal`/`numeric`/`money` a `Number` (pierde
 * precisión) y las fechas a `Date` (pierde los 100 ns de `datetime2` y el
 * desplazamiento de `datetimeoffset`). Los parsers de filas llaman a
 * `valueParser.readValue` a través del objeto del módulo en cada fila, así que
 * basta con envolver esa función: estos tipos se leen aquí como texto crudo y
 * el resto sigue en `tedious`. Sin parches a archivos de `node_modules`.
 */

interface TediousResult<T> {
  value: T;
  offset: number;
}

interface ValueMetadata {
  type: { name: string };
  scale?: number;
}

type ReadValue = (buf: Buffer, offset: number, metadata: ValueMetadata, options: unknown) => TediousResult<unknown>;

interface ValueParserModule {
  readValue: ReadValue;
}

interface HelpersModule {
  Result: new <T>(value: T, offset: number) => TediousResult<T>;
  NotEnoughDataError: new (byteCount: number) => Error;
}

/** Días desde 1970-01-01 → fecha civil proleptica gregoriana (algoritmo de H. Hinnant). */
function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

/** Días entre 0001-01-01 y 1970-01-01, y entre 1900-01-01 y 1970-01-01. */
const EPOCH_0001 = -719162;
const EPOCH_1900 = -25567;

const pad = (n: number | bigint, len = 2): string => String(n).padStart(len, '0');

function dateText(daysSince1970: number): string {
  const { year, month, day } = civilFromDays(daysSince1970);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** `HH:mm:ss[.fffffff]` a partir de unidades de 10^-scale segundos desde medianoche. */
function timeText(units: bigint, scale: number): string {
  const perSecond = 10n ** BigInt(scale);
  const seconds = units / perSecond;
  const fraction = units % perSecond;
  const h = seconds / 3600n;
  const m = (seconds / 60n) % 60n;
  const s = seconds % 60n;
  return `${pad(h)}:${pad(m)}:${pad(s)}${scale > 0 ? `.${pad(fraction, scale)}` : ''}`;
}

/** Decimal en texto sin pasar por `Number`. */
export function decimalText(unscaled: bigint, scale: number, negative: boolean): string {
  let digits = unscaled.toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  }
  return negative && unscaled !== 0n ? `-${digits}` : digits;
}

function unsignedLE(buf: Buffer, offset: number, length: number): bigint {
  let value = 0n;
  for (let i = length - 1; i >= 0; i--) value = (value << 8n) | BigInt(buf[offset + i]!);
  return value;
}

let installed = false;

/** Instala la lectura exacta en `tedious` (una vez por proceso). */
export function installExactValues(): void {
  if (installed) return;
  installed = true;
  const require = createRequire(import.meta.url);
  const parser = require('tedious/lib/value-parser') as ValueParserModule;
  const helpers = require('tedious/lib/token/helpers') as HelpersModule;
  const original = parser.readValue;

  const need = (buf: Buffer, offset: number, length: number): void => {
    if (buf.length < offset + length) throw new helpers.NotEnoughDataError(offset + length);
  };
  const result = <T>(value: T, offset: number): TediousResult<T> => new helpers.Result(value, offset);

  /** Longitud de un byte que precede a los tipos de largo variable (0 = NULL). */
  const lengthPrefixed = (
    buf: Buffer,
    offset: number,
    read: (start: number, length: number) => string,
  ): TediousResult<string | null> => {
    need(buf, offset, 1);
    const length = buf[offset]!;
    if (length === 0) return result(null, offset + 1);
    need(buf, offset + 1, length);
    return result(read(offset + 1, length), offset + 1 + length);
  };

  const money = (buf: Buffer, start: number, length: number): string => {
    if (length === 4) {
      const v = buf.readInt32LE(start);
      return decimalText(BigInt(Math.abs(v)), 4, v < 0);
    }
    const v = (BigInt(buf.readInt32LE(start)) << 32n) | BigInt(buf.readUInt32LE(start + 4));
    return decimalText(v < 0n ? -v : v, 4, v < 0n);
  };
  const datetime = (buf: Buffer, start: number, length: number): string => {
    if (length === 4) {
      const days = buf.readUInt16LE(start);
      const minutes = buf.readUInt16LE(start + 2);
      return `${dateText(EPOCH_1900 + days)} ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`;
    }
    const days = buf.readInt32LE(start);
    // Unidades de 1/300 s; SQL Server las muestra redondeadas a milisegundos (.000, .003, .007).
    const ms = Math.round((buf.readUInt32LE(start + 4) * 10) / 3);
    return `${dateText(EPOCH_1900 + days + Math.floor(ms / 86_400_000))} ${timeText(BigInt(ms % 86_400_000), 3)}`;
  };

  parser.readValue = (buf, offset, metadata, options) => {
    const scale = metadata.scale ?? 7;
    switch (metadata.type.name) {
      case 'NumericN':
      case 'DecimalN':
        return lengthPrefixed(buf, offset, (start, length) =>
          decimalText(unsignedLE(buf, start + 1, length - 1), scale, buf[start] === 0),
        );
      case 'Money':
        need(buf, offset, 8);
        return result(money(buf, offset, 8), offset + 8);
      case 'SmallMoney':
        need(buf, offset, 4);
        return result(money(buf, offset, 4), offset + 4);
      case 'MoneyN':
        return lengthPrefixed(buf, offset, (start, length) => money(buf, start, length));
      case 'DateTime':
        need(buf, offset, 8);
        return result(datetime(buf, offset, 8), offset + 8);
      case 'SmallDateTime':
        need(buf, offset, 4);
        return result(datetime(buf, offset, 4), offset + 4);
      case 'DateTimeN':
        return lengthPrefixed(buf, offset, (start, length) => datetime(buf, start, length));
      case 'Date':
        return lengthPrefixed(buf, offset, (start) => dateText(EPOCH_0001 + buf.readUIntLE(start, 3)));
      case 'Time':
        return lengthPrefixed(buf, offset, (start, length) => timeText(unsignedLE(buf, start, length), scale));
      case 'DateTime2':
        return lengthPrefixed(buf, offset, (start, length) => {
          const time = unsignedLE(buf, start, length - 3);
          const days = buf.readUIntLE(start + length - 3, 3);
          return `${dateText(EPOCH_0001 + days)} ${timeText(time, scale)}`;
        });
      case 'DateTimeOffset':
        return lengthPrefixed(buf, offset, (start, length) => {
          // Se guarda en UTC con el desplazamiento aparte: se muestra la hora local de ese desplazamiento.
          const perDay = 86_400n * 10n ** BigInt(scale);
          const time = unsignedLE(buf, start, length - 5);
          const days = BigInt(buf.readUIntLE(start + length - 5, 3));
          const minutes = buf.readInt16LE(start + length - 2);
          const local = days * perDay + time + BigInt(minutes) * 60n * 10n ** BigInt(scale);
          const sign = minutes < 0 ? '-' : '+';
          const abs = Math.abs(minutes);
          return `${dateText(EPOCH_0001 + Number(local / perDay))} ${timeText(local % perDay, scale)} ${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
        });
      default:
        return original(buf, offset, metadata, options);
    }
  };
}
