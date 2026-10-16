import { describe, expect, it } from 'vitest';
import { parseSqliteChecks } from '../../src/db-host/drivers/sqlite/checks';

describe('CHECK de SQLite leídos del CREATE TABLE', () => {
  it('lee las de tabla con nombre y las de columna', () => {
    const checks = parseSqliteChecks(`CREATE TABLE t (
      id integer PRIMARY KEY,
      edad int CHECK (edad >= 0 AND edad < 150),
      n int,
      CONSTRAINT positivo CHECK (n > 0),
      CHECK (n <> edad)
    )`);
    expect(checks).toEqual([
      { name: undefined, columns: ['edad'], expression: 'edad >= 0 AND edad < 150' },
      { name: 'positivo', columns: [], expression: 'n > 0' },
      { name: undefined, columns: [], expression: 'n <> edad' },
    ]);
  });

  it('respeta paréntesis anidados, comillas y nombres entre comillas', () => {
    const checks = parseSqliteChecks(
      `CREATE TABLE "Mi Tabla" ("Col A" text CONSTRAINT "ck a" CHECK (length("Col A") IN (1, 2) AND "Col A" <> 'check (x)'))`,
    );
    expect(checks).toEqual([
      {
        name: 'ck a',
        columns: ['Col A'],
        expression: `length("Col A") IN (1, 2) AND "Col A" <> 'check (x)'`,
      },
    ]);
  });

  it('no confunde una columna llamada "check" ni un default entre paréntesis', () => {
    expect(parseSqliteChecks('CREATE TABLE t (a int DEFAULT (1 + 2), b text)')).toEqual([]);
    expect(parseSqliteChecks('CREATE TABLE t (a int, b text)')).toEqual([]);
    expect(parseSqliteChecks('')).toEqual([]);
  });
});
