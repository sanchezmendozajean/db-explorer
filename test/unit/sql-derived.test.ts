import { describe, expect, it } from 'vitest';
import type { DerivedRelation } from '@shared/sql-context';
import { completionContext, derivedRelations, dollarBodyAt } from '@shared/sql-context';

const names = (r: DerivedRelation | undefined): string[] =>
  (r?.items ?? []).map((i) => ('name' in i ? i.name : `*${i.star.qualifier ?? ''}`));

describe('CTE y tablas derivadas', () => {
  it('toma las columnas de la lista del SELECT: alias, tabla.columna y columnas simples', () => {
    const [x] = derivedRelations(
      'with x as (select a, b as bb, t.c, count(*) n, count(*), p.d dd from t) select * from x',
      'postgres',
    );
    expect(x).toMatchObject({ name: 'x', kind: 'cte' });
    expect(names(x)).toEqual(['a', 'bb', 'c', 'n', 'dd']);
    expect(x!.sources.map((s) => s.name)).toEqual(['t']);
  });

  it('usa la lista de columnas del CTE y entiende varios CTE y RECURSIVE', () => {
    const rels = derivedRelations(
      'with recursive a(p, q) as (select 1, 2), b as (select z from a) select * from b',
      'postgres',
    );
    expect(rels.map((r) => r.name)).toEqual(['a', 'b']);
    expect(names(rels[0])).toEqual(['p', 'q']);
    expect(names(rels[1])).toEqual(['z']);
  });

  it('reconoce tablas derivadas con y sin AS', () => {
    const rels = derivedRelations(
      'select * from (select id, nombre apodo from clientes) d join (select 1 as uno) as e on 1=1',
      'postgres',
    );
    expect(rels.map((r) => [r.name, r.kind, names(r)])).toEqual([
      ['d', 'derived', ['id', 'apodo']],
      ['e', 'derived', ['uno']],
    ]);
  });

  it('marca los * para expandirlos, con su calificador', () => {
    const [x] = derivedRelations('with x as (select t.*, u.id, * from t join u on 1=1) select 1', 'postgres');
    expect(names(x)).toEqual(['*t', 'id', '*']);
  });

  it('ignora los casts de PostgreSQL, DISTINCT y TOP de SQL Server', () => {
    expect(
      names(
        derivedRelations('with x as (select distinct a::int, b::text as bt from t) select 1', 'postgres')[0],
      ),
    ).toEqual(['a', 'bt']);
    expect(names(derivedRelations('with x as (select top 5 a, b from t) select 1', 'sqlserver')[0])).toEqual([
      'a',
      'b',
    ]);
    expect(
      names(derivedRelations('with x as (select top (10) percent a from t) select 1', 'sqlserver')[0]),
    ).toEqual(['a']);
  });

  it('no confunde CASE ... END, operadores ni expresiones con alias', () => {
    const [x] = derivedRelations(
      "with x as (select case when a > 1 then 'x' else 'y' end, a + b, a + b as suma, a * b prod from t) select 1",
      'postgres',
    );
    expect(names(x)).toEqual(['suma', 'prod']);
  });

  it('no toma por CTE un WITH (NOLOCK) ni por tabla derivada una subconsulta escalar', () => {
    expect(derivedRelations('select * from t with (nolock) where a = 1', 'sqlserver')).toEqual([]);
    expect(derivedRelations('select (select max(x) from t) m, a from u', 'postgres')).toEqual([]);
    expect(derivedRelations('select * from t where a in (select id from u)', 'postgres')).toEqual([]);
  });

  it('funciona con la sentencia a medio escribir (paréntesis sin cerrar)', () => {
    const [x] = derivedRelations('with x as (select a, b from t where ', 'postgres');
    expect(names(x)).toEqual(['a', 'b']);
  });

  it('entiende los identificadores entre comillas de cada dialecto', () => {
    expect(
      names(derivedRelations('with "X" as (select "Col A", t."Col B" from t) select 1', 'postgres')[0]),
    ).toEqual(['Col A', 'Col B']);
    expect(names(derivedRelations('with x as (select [a b] from t) select 1', 'sqlserver')[0])).toEqual([
      'a b',
    ]);
    expect(names(derivedRelations('select * from (select `a` from t) `d`', 'mariadb')[0])).toEqual(['a']);
  });

  it('el contexto de completado las incluye', () => {
    const sql = 'with x as (select a from t) select  from x';
    const ctx = completionContext(sql, sql.indexOf('select ') + 7, 'postgres');
    expect(ctx.kind).toBe('columns');
    expect(ctx.derived.map((d) => d.name)).toEqual(['x']);
    expect(ctx.tables.map((t) => t.name)).toEqual(['t', 'x']);
  });
});

describe('cuerpo entre $$ de PostgreSQL', () => {
  const sql = 'CREATE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE sql';
  it('ubica el cuerpo que contiene el cursor', () => {
    const start = sql.indexOf('$$') + 2;
    const end = sql.lastIndexOf('$$');
    expect(dollarBodyAt(sql, start + 3)).toEqual({ start, end });
    expect(dollarBodyAt(sql, 5)).toBeNull();
    expect(dollarBodyAt(sql, sql.length)).toBeNull();
  });

  it('entiende etiquetas con nombre, cuerpos sin cerrar y los parámetros $1', () => {
    const tagged = 'DO $cuerpo$ BEGIN PERFORM $1; END $cuerpo$';
    const range = dollarBodyAt(tagged, 20)!;
    expect(tagged.slice(range.start, range.end)).toBe(' BEGIN PERFORM $1; END ');
    const open = 'SELECT f() AS $$ SELECT c.';
    expect(dollarBodyAt(open, open.length)).toEqual({ start: open.indexOf('$$') + 2, end: open.length });
    expect(dollarBodyAt('SELECT $1, $2', 9)).toBeNull();
  });
});
