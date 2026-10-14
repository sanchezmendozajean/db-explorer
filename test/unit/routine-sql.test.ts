import { describe, expect, it } from 'vitest';
import { toAlterStatement } from '../../src/db-host/drivers/sqlserver/routine-sql';

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
