import { describe, expect, it } from 'vitest';
import type { CellValue } from '@shared/query';
import { DEFAULT_SETTINGS } from '@shared/settings';
import type { CopySource } from '../../src/renderer/features/results/copy';
import { selectionToTsv, tableToTsv, tsvField } from '../../src/renderer/features/results/copy';
import { formatCell, roundDecimalText } from '../../src/renderer/features/results/format';

const s = DEFAULT_SETTINGS;

describe('formatCell', () => {
  it('muestra NULL y booleanos según la configuración', () => {
    expect(formatCell(null, 'text', s)).toBe('NULL');
    expect(formatCell(null, 'text', { ...s, 'format.null': '∅' })).toBe('∅');
    expect(formatCell(true, 'boolean', { ...s, 'format.boolean': 'sí/no' })).toBe('sí');
    expect(formatCell(false, 'boolean', { ...s, 'format.boolean': '1/0' })).toBe('0');
  });

  it('agrupa miles sin perder precisión en decimales y enteros grandes', () => {
    expect(formatCell('999999999.00', 'decimal', s)).toBe('999,999,999.00');
    expect(formatCell('12345678901234.123456', 'decimal', s)).toBe('12,345,678,901,234.123456');
    expect(formatCell('9223372036854775807', 'integer', s)).toBe('9,223,372,036,854,775,807');
    expect(formatCell(-1234, 'integer', s)).toBe('-1,234');
    expect(formatCell('1234.5', 'decimal', { ...s, 'format.number.thousandsSeparator': false })).toBe(
      '1234.5',
    );
    expect(formatCell('1234.5', 'decimal', { ...s, 'format.number.decimalSeparator': ',' })).toBe('1.234,5');
    expect(formatCell('NaN', 'decimal', s)).toBe('NaN');
  });

  it('aplica los modos de decimales', () => {
    expect(formatCell('10.500', 'decimal', { ...s, 'format.decimal.mode': 'trimZeros' })).toBe('10.5');
    expect(formatCell('10.000', 'decimal', { ...s, 'format.decimal.mode': 'trimZeros' })).toBe('10');
    expect(formatCell('2.345', 'decimal', { ...s, 'format.decimal.mode': 'fixed' })).toBe('2.35');
    expect(roundDecimalText('9.995', 2)).toBe('10.00');
    expect(roundDecimalText('-0.004', 2)).toBe('0.00');
    expect(roundDecimalText('12345678901234567890.125', 2)).toBe('12345678901234567890.13');
    expect(roundDecimalText('5', 0)).toBe('5');
  });

  it('limita los dígitos de los flotantes', () => {
    expect(formatCell('0.1', 'float', s)).toBe('0.1');
    expect(formatCell('0.30000000000000004', 'float', s)).toBe('0.3');
    expect(formatCell('Infinity', 'float', s)).toBe('Infinity');
  });

  it('formatea fechas sin cambiar la zona y con milisegundos solo si existen', () => {
    expect(formatCell('2026-09-30 08:42:52.658', 'datetime', s)).toBe('2026-09-30 08:42:52.658');
    expect(formatCell('2026-09-30 08:42:52', 'datetime', s)).toBe('2026-09-30 08:42:52');
    expect(
      formatCell('2026-09-30 08:42:52', 'datetime', { ...s, 'format.datetime.showMillis': 'always' }),
    ).toBe('2026-09-30 08:42:52.000');
    expect(
      formatCell('2026-09-30 08:42:52.658', 'datetime', { ...s, 'format.datetime': 'dd/MM/yyyy HH:mm' }),
    ).toBe('30/09/2026 08:42');
    expect(formatCell('2026-09-30 08:42:52-05', 'datetimetz', s)).toBe('2026-09-30 08:42:52-05');
    expect(
      formatCell('2026-09-30 13:42:52+00', 'datetimetz', { ...s, 'format.datetimetz.display': 'utc' }),
    ).toBe('2026-09-30 13:42:52Z');
    expect(formatCell('2026-02-28', 'date', { ...s, 'format.date': 'dd/MM/yyyy' })).toBe('28/02/2026');
    expect(formatCell('08:05:09.5', 'time', s)).toBe('08:05:09.5');
    expect(formatCell('infinity', 'datetime', s)).toBe('infinity');
  });

  it('muestra binarios en hex, base64 o tamaño', () => {
    expect(formatCell('\\x89504e47', 'binary', s)).toBe('0x89504E47');
    expect(formatCell('\\x89504e47', 'binary', { ...s, 'format.binary.maxBytes': 2 })).toBe('0x8950…');
    expect(formatCell('\\x4869', 'binary', { ...s, 'format.binary': 'base64' })).toBe('SGk=');
    expect(formatCell('\\x4869', 'binary', { ...s, 'format.binary': 'size' })).toBe('2 bytes');
  });

  it('trunca el texto largo y muestra los saltos de línea en una línea', () => {
    expect(formatCell('a\nb', 'text', s)).toBe('a↵b');
    expect(formatCell('x'.repeat(600), 'text', s)).toHaveLength(501);
  });
});

function source(rows: CellValue[][], headers: string[]): CopySource {
  return {
    rowCount: rows.length,
    columnCount: headers.length,
    header: (c) => headers[c]!,
    value: (r, c) => rows[r]![c]!,
  };
}

const data = source(
  [
    [1, 'Ana', '10.50', null],
    [2, 'Luis\tPérez', '20.00', true],
    [3, 'con "comillas"', '30.00', false],
  ],
  ['id', 'nombre', 'importe', 'activo'],
);
const opts = { headers: false, nullAs: '' };

describe('copia TSV de la selección', () => {
  it('una celda: solo el valor, sin salto de línea final', () => {
    const sel = { rects: [{ x: 1, y: 0, width: 1, height: 1 }], rows: [], columns: [] };
    expect(selectionToTsv(sel, data, opts)).toBe('Ana');
    expect(selectionToTsv(sel, data, { ...opts, headers: true })).toBe('nombre\r\nAna');
  });

  it('un rango con cabeceras, NULL vacío y comillas según Excel', () => {
    const sel = { rects: [{ x: 1, y: 0, width: 3, height: 3 }], rows: [], columns: [] };
    expect(selectionToTsv(sel, data, { ...opts, headers: true })).toBe(
      'nombre\timporte\tactivo\r\nAna\t10.50\t\r\n"Luis\tPérez"\t20.00\ttrue\r\n"con ""comillas"""\t30.00\tfalse\r\n',
    );
    expect(selectionToTsv(sel, data, { headers: false, nullAs: 'NULL' }).split('\r\n')[0]).toBe(
      'Ana\t10.50\tNULL',
    );
  });

  it('dos columnas no contiguas con Ctrl+clic: solo esas columnas y sus cabeceras', () => {
    const sel = { rects: [], rows: [], columns: [0, 2] };
    expect(selectionToTsv(sel, data, { ...opts, headers: true })).toBe(
      'id\timporte\r\n1\t10.50\r\n2\t20.00\r\n3\t30.00\r\n',
    );
  });

  it('filas completas', () => {
    const sel = { rects: [], rows: [2], columns: [] };
    expect(selectionToTsv(sel, data, opts)).toBe('3\t"con ""comillas"""\t30.00\tfalse\r\n');
  });

  it('selección no rectangular: las celdas no seleccionadas del contorno van vacías', () => {
    const sel = {
      rects: [
        { x: 0, y: 0, width: 1, height: 1 },
        { x: 2, y: 2, width: 1, height: 1 },
      ],
      rows: [],
      columns: [],
    };
    expect(selectionToTsv(sel, data, opts)).toBe('1\t\r\n\t30.00\r\n');
  });

  it('copiar tabla: todas las filas y columnas sin importar la selección', () => {
    expect(tableToTsv(data, { ...opts, headers: true }).split('\r\n')).toHaveLength(5);
    expect(tableToTsv(source([], ['a', 'b']), { ...opts, headers: true })).toBe('a\tb\r\n');
    expect(tableToTsv(source([[7]], ['n']), { ...opts, headers: true })).toBe('n\r\n7\r\n');
  });

  it('escapa campos con saltos de línea', () => {
    expect(tsvField('a\r\nb')).toBe('"a\r\nb"');
    expect(tsvField('simple')).toBe('simple');
  });
});
