import { describe, expect, it } from 'vitest';
import { completionContext, tableMentions } from '@shared/sql-context';

/** Contexto con el cursor donde está la barra vertical. */
function at(sql: string, dialect: 'postgres' | 'mariadb' | 'sqlserver' = 'postgres') {
  const offset = sql.indexOf('|');
  return completionContext(sql.replace('|', ''), offset, dialect);
}

describe('tablas de la sentencia', () => {
  it('resuelve esquemas, alias con y sin AS, JOIN y listas con coma', () => {
    expect(
      tableMentions(
        'select * from dbx.clientes c, otra join pedidos as p on p.id = c.id where 1=1',
        'postgres',
      ),
    ).toEqual([
      { schema: 'dbx', name: 'clientes', alias: 'c' },
      { schema: undefined, name: 'otra', alias: undefined },
      { schema: undefined, name: 'pedidos', alias: 'p' },
    ]);
  });

  it('entiende identificadores entre comillas de cada dialecto', () => {
    expect(tableMentions('select 1 from "dbx"."CRendiciones" "X"', 'postgres')).toEqual([
      { schema: 'dbx', name: 'CRendiciones', alias: 'X' },
    ]);
    expect(tableMentions('update [dbo].[Mi Tabla] set a = 1', 'sqlserver')).toEqual([
      { schema: 'dbo', name: 'Mi Tabla', alias: undefined },
    ]);
    expect(tableMentions('insert into `db`.`t` values (1)', 'mariadb')).toEqual([
      { schema: 'db', name: 't', alias: undefined },
    ]);
  });
});

describe('contexto del cursor', () => {
  it('SELECT c. FROM clientes c: columnas del alias', () => {
    expect(at('SELECT c.| FROM clientes c')).toMatchObject({
      kind: 'members',
      qualifier: ['c'],
      prefix: '',
      tables: [{ name: 'clientes', alias: 'c' }],
    });
  });

  it('después de FROM, JOIN o una coma en el FROM: tablas', () => {
    expect(at('select * from |').kind).toBe('tables');
    expect(at('select * from a join cl|').kind).toBe('tables');
    expect(at('select * from a, |').kind).toBe('tables');
    expect(at('update |').kind).toBe('tables');
  });

  it('en SELECT, WHERE y ON: columnas', () => {
    expect(at('select | from t').kind).toBe('columns');
    expect(at('select a from t where |').kind).toBe('columns');
    expect(at('select * from t join u on |').kind).toBe('columns');
    expect(at('select * from t order by |').kind).toBe('columns');
  });

  it('esquema y tabla calificados, y prefijos con comilla', () => {
    expect(at('select * from dbx.|')).toMatchObject({ kind: 'members', qualifier: ['dbx'] });
    expect(at('select dbx.t.na| from dbx.t')).toMatchObject({
      kind: 'members',
      qualifier: ['dbx', 't'],
      prefix: 'na',
    });
    expect(at('select * from "CRe|')).toMatchObject({ kind: 'tables', prefix: '"CRe' });
    expect(at('select "c".| from x "c"')).toMatchObject({ kind: 'members', qualifier: ['c'] });
  });

  it('fuera de cláusulas conocidas: general', () => {
    expect(at('sel|').kind).toBe('general');
  });
});
