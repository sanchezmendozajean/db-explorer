import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { decimalText, installExactValues } from '../../src/db-host/drivers/sqlserver/exact-values';
import { toMariaDbError } from '../../src/db-host/drivers/mariadb/errors';
import { toSqlServerError } from '../../src/db-host/drivers/sqlserver/errors';
import { commandOf, positionOfSnippet } from '../../src/db-host/drivers/common';

const require = createRequire(import.meta.url);

type ReadValue = (buf: Buffer, offset: number, meta: object, options: object) => { value: unknown; offset: number };

describe('valores exactos de SQL Server', () => {
  installExactValues();
  const { readValue } = require('tedious/lib/value-parser') as { readValue: ReadValue };
  const read = (name: string, bytes: number[], scale?: number): unknown =>
    readValue(Buffer.from(bytes), 0, { type: { name }, scale }, { useUTC: true }).value;

  it('decimalText respeta escala, ceros y signo', () => {
    expect(decimalText(12345678901234123456n, 6, false)).toBe('12345678901234.123456');
    expect(decimalText(5n, 4, true)).toBe('-0.0005');
    expect(decimalText(0n, 2, true)).toBe('0.00');
    expect(decimalText(42n, 0, false)).toBe('42');
  });

  it('lee decimal(38) sin pasar por Number', () => {
    // 10^37 + 1 con escala 0: 17 bytes = signo + 16 bytes little-endian.
    const v = 10n ** 37n + 1n;
    const bytes = [17, 1, ...Array.from({ length: 16 }, (_, i) => Number((v >> BigInt(i * 8)) & 0xffn))];
    expect(read('DecimalN', bytes, 0)).toBe('10000000000000000000000000000000000001');
    expect(read('NumericN', [0], 2)).toBeNull();
  });

  it('lee fechas y horas como texto exacto', () => {
    // date 2026-02-28: días desde 0001-01-01 = 739674.
    const days = 739674;
    const date = [days & 0xff, (days >> 8) & 0xff, (days >> 16) & 0xff];
    expect(read('Date', [3, ...date])).toBe('2026-02-28');
    // time(7) 08:44:12.6581234 = 314 526 581 234 unidades de 100 ns.
    const units = 314_526_581_234n;
    const time = Array.from({ length: 5 }, (_, i) => Number((units >> BigInt(i * 8)) & 0xffn));
    expect(read('DateTime2', [8, ...time, ...date], 7)).toBe('2026-02-28 08:44:12.6581234');
    expect(read('Time', [5, ...time], 7)).toBe('08:44:12.6581234');
  });

  it('lee money negativo con cuatro decimales', () => {
    const v = -9223372036854775808n;
    const high = Number(v >> 32n);
    const low = Number(v & 0xffffffffn);
    const buf = Buffer.alloc(8);
    buf.writeInt32LE(high, 0);
    buf.writeUInt32LE(low, 4);
    expect(read('Money', [...buf])).toBe('-922337203685477.5808');
  });
});

describe('posiciones de error', () => {
  const sql = 'SELECT 1,\nFROM x';

  it('MariaDB: fragmento y línea', () => {
    const err = toMariaDbError(
      { sqlMessage: "You have an error in your SQL syntax; check the manual … near 'FROM x' at line 2", code: 'ER_PARSE_ERROR' },
      sql,
    );
    expect(err.extra.position).toBe(11);
    expect(err.code).toBe('ER_PARSE_ERROR');
  });

  it('SQL Server: palabra clave citada y varios errores', () => {
    const err = toSqlServerError(
      { errors: [{ message: "Incorrect syntax near the keyword 'FROM'.", number: 156, lineNumber: 2 }, { message: 'Otro' }] },
      sql,
    );
    expect(err.extra.position).toBe(11);
    expect(err.message).toBe("Incorrect syntax near the keyword 'FROM'.\nOtro");
    expect(err.code).toBe('156');
  });

  it('sin fragmento usa el inicio de la línea', () => {
    expect(positionOfSnippet(sql, undefined, 2)).toBe(11);
    expect(positionOfSnippet(sql, undefined, 1)).toBeUndefined();
  });

  it('commandOf toma la primera palabra clave', () => {
    expect(commandOf('-- x\n  update t set a = 1', 'sqlserver')).toBe('UPDATE');
  });
});
