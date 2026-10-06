import type { CellValue, LogicalType } from '@shared/query';
import type { ColumnFormat, Settings } from '@shared/settings';

/**
 * Formateo de presentación de celdas (specs/06 §Formatos de datos, nivel
 * global). Los valores llegan crudos (texto del motor); nunca se modifica el
 * valor, solo cómo se muestra. Copiar y exportar usan el valor crudo.
 */

export type FormatSettings = Pick<
  Settings,
  | 'format.locale'
  | 'format.null'
  | 'format.number.thousandsSeparator'
  | 'format.number.decimalSeparator'
  | 'format.decimal.mode'
  | 'format.decimal.places'
  | 'format.float.maxDigits'
  | 'format.date'
  | 'format.time'
  | 'format.datetime'
  | 'format.datetime.showMillis'
  | 'format.datetimetz.display'
  | 'format.boolean'
  | 'format.binary'
  | 'format.binary.maxBytes'
  | 'format.json'
  | 'format.text.maxLength'
>;

interface Separators {
  thousands: string;
  decimal: string;
}

const separatorCache = new Map<string, Separators>();

export function separators(s: FormatSettings): Separators {
  const key = `${s['format.locale']}|${s['format.number.decimalSeparator']}|${s['format.number.thousandsSeparator']}`;
  const cached = separatorCache.get(key);
  if (cached) return cached;
  let decimal: string;
  let thousands: string;
  if (s['format.number.decimalSeparator'] === 'locale') {
    const parts = localeParts(s['format.locale']);
    decimal = parts.find((p) => p.type === 'decimal')?.value ?? '.';
    thousands = parts.find((p) => p.type === 'group')?.value ?? ',';
  } else {
    decimal = s['format.number.decimalSeparator'];
    thousands = decimal === ',' ? '.' : ',';
  }
  const result = { decimal, thousands: s['format.number.thousandsSeparator'] ? thousands : '' };
  separatorCache.set(key, result);
  return result;
}

function localeParts(locale: string): Intl.NumberFormatPart[] {
  try {
    return new Intl.NumberFormat(locale).formatToParts(1234567.5);
  } catch {
    // Configuración regional inválida: se usa la predeterminada de la app.
    return new Intl.NumberFormat('es-PE').formatToParts(1234567.5);
  }
}

function groupDigits(digits: string, sep: string): string {
  if (!sep || digits.length <= 3) return digits;
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** Aplica separadores a un número en texto decimal plano (`-1234.50`). Otros formatos quedan igual. */
export function formatDecimalText(text: string, sep: Separators): string {
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return text;
  const [, sign, int, frac] = m;
  return `${sign}${groupDigits(int!, sep.thousands)}${frac !== undefined ? sep.decimal + frac : ''}`;
}

/** Redondea un decimal en texto a `places` decimales sin pasar por `Number` (sin perder precisión). */
export function roundDecimalText(text: string, places: number): string {
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return text;
  const sign = m[1] === '-' ? '-' : '';
  const int = m[2]!;
  const frac = m[3] ?? '';
  if (frac.length <= places) return `${sign}${int}${places > 0 ? '.' + frac.padEnd(places, '0') : ''}`;
  const digits = (int + frac.slice(0, places)).split('').map(Number);
  if (Number(frac[places]) >= 5) {
    let i = digits.length - 1;
    while (i >= 0) {
      if (digits[i]! < 9) {
        digits[i]!++;
        break;
      }
      digits[i] = 0;
      i--;
    }
    if (i < 0) digits.unshift(1);
  }
  const all = digits.join('');
  const intPart = all.slice(0, all.length - places) || '0';
  const fracPart = all.slice(all.length - places);
  const isZero = /^0*$/.test(intPart + fracPart);
  return `${isZero ? '' : sign}${intPart}${places > 0 ? '.' + fracPart : ''}`;
}

function formatDecimal(raw: string, s: FormatSettings): string {
  let text = raw;
  const mode = s['format.decimal.mode'];
  if (mode === 'fixed') text = roundDecimalText(raw, s['format.decimal.places']);
  else if (mode === 'trimZeros' && text.includes('.')) text = text.replace(/\.?0+$/, '');
  return formatDecimalText(text, separators(s));
}

function formatFloat(raw: string, s: FormatSettings): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const text = String(Number(n.toPrecision(s['format.float.maxDigits'])));
  return formatDecimalText(text, separators(s));
}

interface DateParts {
  year: string;
  month: string;
  day: string;
  hour?: string;
  minute?: string;
  second?: string;
  fraction?: string;
  offset?: string;
}

/** Interpreta fechas/horas en texto ISO de PostgreSQL (`2026-09-30 08:42:52.658-05`). */
export function parseDateTime(raw: string): DateParts | null {
  const m =
    /^(\d{4,})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?)?\s*([+-]\d{2}(?::?\d{2}){0,2}|Z)?$/.exec(
      raw,
    );
  if (!m) return null;
  return {
    year: m[1]!,
    month: m[2]!,
    day: m[3]!,
    hour: m[4],
    minute: m[5],
    second: m[6],
    fraction: m[7],
    offset: m[8],
  };
}

function parseTime(
  raw: string,
): { hour: string; minute: string; second: string; fraction?: string; offset?: string } | null {
  const m = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([+-]\d{2}(?::?\d{2})?)?$/.exec(raw);
  if (!m) return null;
  return { hour: m[1]!, minute: m[2]!, second: m[3]!, fraction: m[4], offset: m[5] };
}

function applyPattern(
  pattern: string,
  p: Partial<Record<'yyyy' | 'MM' | 'dd' | 'HH' | 'mm' | 'ss', string>>,
): string {
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, (token) => p[token as keyof typeof p] ?? token);
}

function millis(fraction: string | undefined, s: FormatSettings): string {
  const mode = s['format.datetime.showMillis'];
  if (mode === 'never') return '';
  if (mode === 'always') return `.${(fraction ?? '').padEnd(3, '0')}`;
  return fraction ? `.${fraction}` : '';
}

const pad = (n: number, len = 2): string => String(n).padStart(len, '0');

function formatDateTime(raw: string, s: FormatSettings, withZone: boolean): string {
  const p = parseDateTime(raw);
  if (!p || p.hour === undefined) return raw;
  let parts = { yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute!, ss: p.second! };
  let offset = withZone ? (p.offset ?? '') : '';
  const display = s['format.datetimetz.display'];
  if (withZone && display !== 'asStored' && p.offset) {
    const iso = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${p.offset === 'Z' ? 'Z' : normalizeOffset(p.offset)}`;
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) {
      const utc = display === 'utc';
      parts = {
        yyyy: pad(utc ? date.getUTCFullYear() : date.getFullYear(), 4),
        MM: pad((utc ? date.getUTCMonth() : date.getMonth()) + 1),
        dd: pad(utc ? date.getUTCDate() : date.getDate()),
        HH: pad(utc ? date.getUTCHours() : date.getHours()),
        mm: pad(utc ? date.getUTCMinutes() : date.getMinutes()),
        ss: pad(utc ? date.getUTCSeconds() : date.getSeconds()),
      };
      offset = utc ? 'Z' : '';
    }
  }
  // Los milisegundos van justo después de los segundos.
  const text = applyPattern(s['format.datetime'], { ...parts, ss: `${parts.ss}${millis(p.fraction, s)}` });
  return `${text}${offset}`;
}

function normalizeOffset(offset: string): string {
  const m = /^([+-])(\d{2}):?(\d{2})?/.exec(offset);
  return m ? `${m[1]}${m[2]}:${m[3] ?? '00'}` : offset;
}

function formatDate(raw: string, s: FormatSettings): string {
  const p = parseDateTime(raw);
  if (!p) return raw;
  return applyPattern(s['format.date'], { yyyy: p.year, MM: p.month, dd: p.day });
}

function formatTime(raw: string, s: FormatSettings): string {
  const t = parseTime(raw);
  if (!t) return raw;
  const text = applyPattern(s['format.time'], {
    HH: t.hour,
    mm: t.minute,
    ss: `${t.second}${millis(t.fraction, s)}`,
  });
  return `${text}${t.offset ?? ''}`;
}

/** Bytes de un valor binario en texto: `\x89504e47` (PostgreSQL) o `0x89504E47` (los demás motores). */
export function binaryHex(raw: string): string | null {
  return /^(\\x|0x)[0-9a-fA-F]*$/.test(raw) ? raw.slice(2) : null;
}

function formatBinary(raw: string, s: FormatSettings): string {
  const hex = binaryHex(raw);
  if (hex === null) return raw;
  const bytes = hex.length / 2;
  const mode = s['format.binary'];
  if (mode === 'size') return `${bytes.toLocaleString('es')} bytes`;
  const max = s['format.binary.maxBytes'];
  const shown = hex.slice(0, max * 2);
  const more = bytes > max ? '…' : '';
  if (mode === 'hex') return `0x${shown.toUpperCase()}${more}`;
  const binary = String.fromCharCode(...(shown.match(/../g) ?? []).map((b) => parseInt(b, 16)));
  return `${btoa(binary)}${more}`;
}

const BOOLEAN_TEXT: Record<Exclude<Settings['format.boolean'], 'checkbox'>, [string, string]> = {
  'true/false': ['true', 'false'],
  '1/0': ['1', '0'],
  'sí/no': ['sí', 'no'],
};

/** Texto de una celda para la grilla. */
export function formatCell(value: CellValue, type: LogicalType, s: FormatSettings): string {
  if (value === null) return s['format.null'];
  if (typeof value === 'boolean') {
    const mode = s['format.boolean'];
    const [yes, no] = mode === 'checkbox' ? ['true', 'false'] : BOOLEAN_TEXT[mode];
    return value ? yes : no;
  }
  if (typeof value === 'number') {
    // SQLite entrega los reales como número: se les aplica igual el formato de decimales o flotantes.
    if (type === 'decimal') return formatDecimal(String(value), s);
    if (type === 'float') return formatFloat(String(value), s);
    return type === 'integer' ? formatDecimalText(String(value), separators(s)) : String(value);
  }
  switch (type) {
    case 'integer':
      return formatDecimalText(value, separators(s));
    case 'decimal':
      return formatDecimal(value, s);
    case 'float':
      return formatFloat(value, s);
    case 'date':
      return formatDate(value, s);
    case 'time':
      return formatTime(value, s);
    case 'datetime':
      return formatDateTime(value, s, false);
    case 'datetimetz':
      return formatDateTime(value, s, true);
    case 'binary':
      return formatBinary(value, s);
    case 'json':
      return truncate(value.replace(/\s*\r?\n\s*/g, ' '), s['format.text.maxLength']);
    default:
      // Texto: saltos de línea visibles en una sola línea y truncado visual.
      return truncate(value.replace(/\r?\n/g, '↵'), s['format.text.maxLength']);
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function isNumericType(type: LogicalType): boolean {
  return type === 'integer' || type === 'decimal' || type === 'float';
}

/** Formato global con el de una columna encima (specs/06 §Formato por columna). */
export function withColumnFormat(s: FormatSettings, format: ColumnFormat | undefined): FormatSettings {
  if (!format) return s;
  const merged: Record<string, unknown> = { ...s };
  for (const [key, value] of Object.entries(format)) {
    if (key !== 'align' && value !== undefined) merged[`format.${key}`] = value;
  }
  return merged as FormatSettings;
}

/** Formato global con el de la conexión encima (specs/06, nivel 2). */
export function withConnectionFormat(s: Settings, connectionId: string | undefined): Settings {
  const format = connectionId ? s['format.connections'][connectionId] : undefined;
  return format ? (withColumnFormat(s, format) as Settings) : s;
}
