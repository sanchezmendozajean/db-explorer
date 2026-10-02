import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { QueryEvent, ResultColumn } from '@shared/query';
import { ConnectionManager, defaultDriverFactory } from '../../src/db-host/connection-manager';
import { engineCases } from './engines';

/**
 * Exportación en flujo (specs/09 M7): 500 000 filas a CSV sin exceder
 * ~500 MB de memoria, y un XLSX que se puede abrir (ZIP con tipos reales).
 */

const cases = await engineCases(inject('pg'));
const postgres = cases.find((c) => c.engine === 'postgres')!;

/** Lee las entradas de un ZIP (directorio central) y descomprime una por nombre. */
function unzip(file: string): Map<string, string> {
  const buf = readFileSync(file);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const entries = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    entries.set(name, inflateRawSync(buf.subarray(dataStart, dataStart + csize)).toString('utf8'));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

describe('exportación a archivo', () => {
  const events: QueryEvent[] = [];
  const manager = new ConnectionManager(defaultDriverFactory, (e) => events.push(e));
  const dir = mkdtempSync(join(tmpdir(), 'dbx-export-'));
  const target = {
    sessionId: 'export-tab',
    connectionId: postgres.config.id,
    database: postgres.config.database,
  };

  beforeAll(() => manager.connect(postgres.config, postgres.password));
  afterAll(() => manager.disconnectAll());

  it('500 000 filas a CSV en flujo sin exceder ~500 MB de memoria', async () => {
    const path = join(dir, 'grande.csv');
    const columns: ResultColumn[] = [
      { name: 'n', nativeType: 'int4', logicalType: 'integer' },
      { name: 'texto', nativeType: 'text', logicalType: 'text' },
      { name: 'importe', nativeType: 'numeric', logicalType: 'decimal' },
      { name: 'fecha', nativeType: 'timestamp', logicalType: 'datetime' },
    ];
    global.gc?.();
    const baseline = process.memoryUsage().rss;
    let peak = baseline;
    const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 25);
    const summary = await manager.export({
      exportId: 'grande',
      path,
      format: 'csv',
      options: { separator: ',', header: true, bom: true, table: '' },
      columns,
      source: {
        kind: 'query',
        ...target,
        sql: `SELECT n, 'fila número ' || n || ' con algo de texto para pesar' AS texto,
                     (n * 1.25)::numeric(12,2) AS importe,
                     TIMESTAMP '2026-01-01' + n * INTERVAL '1 second' AS fecha
                FROM generate_series(1, 500000) AS n`,
        columnIndexes: [0, 1, 2, 3],
      },
    });
    clearInterval(timer);
    peak = Math.max(peak, process.memoryUsage().rss);
    expect(summary).toEqual({ rows: 500_000, cancelled: false });
    const growthMb = (peak - baseline) / 1024 / 1024;
    expect(growthMb).toBeLessThan(500);
    expect(statSync(path).size).toBeGreaterThan(30_000_000);
    const head = readFileSync(path, 'utf8').slice(0, 200).split('\r\n');
    expect(head[0]).toBe('﻿n,texto,importe,fecha');
    expect(head[1]).toBe('1,fila número 1 con algo de texto para pesar,1.25,2026-01-01 00:00:01');
    expect(events.some((e) => e.type === 'export-progress' && e.queryId === 'grande')).toBe(true);
  }, 120_000);

  it('cancelar una exportación borra el archivo a medias', async () => {
    const path = join(dir, 'cancelada.csv');
    const running = manager.export({
      exportId: 'cancelada',
      path,
      format: 'csv',
      options: { separator: ',', header: true, bom: false, table: '' },
      columns: [{ name: 'n', nativeType: 'int4', logicalType: 'integer' }],
      source: {
        kind: 'query',
        ...target,
        sql: 'SELECT n FROM generate_series(1, 50000000) AS n',
        columnIndexes: [0],
      },
    });
    await new Promise((r) => setTimeout(r, 1500));
    await manager.queries.cancel('cancelada');
    const summary = await running;
    expect(summary.cancelled).toBe(true);
    expect(() => statSync(path)).toThrow();
  }, 60_000);

  it('XLSX con números, fechas, booleanos y texto', async () => {
    const path = join(dir, 'tipos.xlsx');
    const columns: ResultColumn[] = [
      { name: 'entero', nativeType: '', logicalType: 'integer' },
      { name: 'decimal', nativeType: '', logicalType: 'decimal' },
      { name: 'fecha', nativeType: '', logicalType: 'date' },
      { name: 'fecha y hora', nativeType: '', logicalType: 'datetime' },
      { name: 'sí', nativeType: '', logicalType: 'boolean' },
      { name: 'texto', nativeType: '', logicalType: 'text' },
    ];
    const summary = await manager.export({
      exportId: 'xlsx',
      path,
      format: 'xlsx',
      options: { separator: ',', header: true, bom: false, table: '' },
      columns,
      source: {
        kind: 'rows',
        rows: [
          [1, '12.50', '2026-02-28', '2026-09-30 08:42:52.658', true, 'a < b & "c"'],
          [2, '123456789012345678.99', null, null, false, null],
        ],
      },
    });
    expect(summary.rows).toBe(2);
    const entries = unzip(path);
    expect([...entries.keys()]).toContain('xl/worksheets/sheet1.xml');
    const sheet = entries.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<c><v>1</v></c><c><v>12.5</v></c>');
    // 2026-02-28 = 46081 en serie de Excel; con hora, la fracción del día.
    expect(sheet).toContain('<c s="1"><v>46081</v></c>');
    expect(sheet).toMatch(/<c s="2"><v>46295\.3631/);
    expect(sheet).toContain('<c t="b"><v>1</v></c>');
    expect(sheet).toContain('a &lt; b &amp; "c"');
    // Más de 15 dígitos: como texto para no perder precisión.
    expect(sheet).toContain('<t xml:space="preserve">123456789012345678.99</t>');
  });
});
