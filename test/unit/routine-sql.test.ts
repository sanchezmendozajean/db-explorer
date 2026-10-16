import { describe, expect, it } from 'vitest';
import { toAlterStatement, toAlterWithMap } from '../../src/db-host/drivers/sqlserver/routine-sql';

describe('toAlterStatement (SQL Server)', () => {
  it('cambia CREATE PROCEDURE por ALTER PROCEDURE y conserva el resto', () => {
    const sql = 'CREATE PROCEDURE [dbo].[ValOpor] @a int AS\nBEGIN SELECT 1 END';
    expect(toAlterStatement(sql)).toBe('ALTER PROCEDURE [dbo].[ValOpor] @a int AS\nBEGIN SELECT 1 END');
  });

  it('acepta CREATE OR ALTER, PROC y FUNCTION sin importar mayúsculas', () => {
    expect(toAlterStatement('create or alter proc dbo.p as select 1')).toBe('ALTER proc dbo.p as select 1');
    expect(toAlterStatement('Create  Function dbo.f() returns int as begin return 1 end')).toBe(
      'ALTER Function dbo.f() returns int as begin return 1 end',
    );
  });

  it('conserva los comentarios que preceden al encabezado', () => {
    const sql = '-- autor: yo\nCREATE PROCEDURE dbo.p AS SELECT 1';
    expect(toAlterStatement(sql)).toBe('-- autor: yo\nALTER PROCEDURE dbo.p AS SELECT 1');
  });

  it('deja igual un ALTER y rechaza lo que no es una rutina', () => {
    expect(toAlterStatement('ALTER PROCEDURE dbo.p AS SELECT 1')).toBe('ALTER PROCEDURE dbo.p AS SELECT 1');
    expect(toAlterStatement('SELECT 1')).toBeNull();
    expect(toAlterStatement('CREATE TABLE t (id int)')).toBeNull();
  });
});

describe('toAlterWithMap: posiciones de error en el texto original (SQL Server)', () => {
  const create = 'CREATE PROCEDURE dbo.p AS SELECT 1 FORM t';
  it('traslada la posición de lo que sigue al encabezado', () => {
    const alter = toAlterWithMap(create)!;
    expect(alter.sql).toBe('ALTER PROCEDURE dbo.p AS SELECT 1 FORM t');
    // "FORM" está una letra más a la izquierda en el texto con ALTER que en el original.
    const inAlter = alter.sql.indexOf('FORM') + 1;
    expect(alter.toOriginal(inAlter)).toBe(create.indexOf('FORM') + 1);
    expect(inAlter).toBe(create.indexOf('FORM'));
  });

  it('no mueve lo que está antes del fin del encabezado ni las posiciones desconocidas', () => {
    const alter = toAlterWithMap(create)!;
    expect(alter.toOriginal(1)).toBe(1);
    expect(alter.toOriginal(undefined)).toBeUndefined();
  });

  it('con CREATE OR ALTER el corrimiento es el largo que se quitó', () => {
    const text = '-- nota\nCREATE OR ALTER PROC dbo.p AS SELECT 1 FORM t';
    const alter = toAlterWithMap(text)!;
    expect(alter.sql).toBe('-- nota\nALTER PROC dbo.p AS SELECT 1 FORM t');
    expect(text.indexOf('FORM') + 1).toBe(alter.toOriginal(alter.sql.indexOf('FORM') + 1));
  });

  it('rechaza lo que no es una rutina', () => {
    expect(toAlterWithMap('SELECT 1')).toBeNull();
  });
});
