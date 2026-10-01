import { describe, expect, it } from 'vitest';
import { analyzeStatement, splitStatements, statementAt } from '@shared/splitter';

const texts = (sql: string): string[] => splitStatements(sql).map((s) => s.text);

describe('splitStatements (PostgreSQL)', () => {
  it('separa por punto y coma y omite vacíos', () => {
    expect(texts('select 1; select 2;\n\n;  select 3')).toEqual(['select 1', 'select 2', 'select 3']);
  });

  it('respeta cadenas, identificadores y escapes', () => {
    expect(texts(`select 'a;b', 'it''s;'; select "x;y" from t`)).toEqual([
      `select 'a;b', 'it''s;'`,
      'select "x;y" from t',
    ]);
    expect(texts(`select E'a\\';b'; select 2`)).toEqual([`select E'a\\';b'`, 'select 2']);
    // Sin prefijo E la barra no escapa: la cadena termina en la comilla.
    expect(texts(`select 'a\\'; select 2`)).toEqual([`select 'a\\'`, 'select 2']);
  });

  it('respeta comentarios de línea y de bloque anidados', () => {
    expect(texts('select 1 -- ; no\n; /* a; /* b; */ c; */ select 2')).toEqual(['select 1', 'select 2']);
  });

  it('omite sentencias que solo tienen comentarios', () => {
    expect(texts('-- solo comentario;\n/* otro */;')).toEqual([]);
  });

  it('empieza la sentencia en el primer token de código', () => {
    const [s] = splitStatements('-- Consultas de prueba\nselect * from clientes;');
    expect(s).toMatchObject({ startLine: 2, startColumn: 1, endLine: 2, endColumn: 24 });
    expect(s!.text).toBe('select * from clientes');
  });

  it('respeta dollar quoting con y sin etiqueta', () => {
    const sql = `create function f() returns int as $$ begin; return 1; end $$ language plpgsql;
do $body$ begin raise notice 'a;b'; end $body$;
select $1, $2 from t;`;
    expect(texts(sql)).toHaveLength(3);
    expect(texts(sql)[2]).toBe('select $1, $2 from t');
  });

  it('no confunde un parámetro $1 con dollar quoting', () => {
    expect(texts('select a$1$b from t; select 2')).toHaveLength(2);
  });

  it('respeta cuerpos BEGIN ATOMIC … END con CASE', () => {
    const sql = `create function g(x int) returns int language sql
begin atomic
  select case when x > 0 then 1 else 0 end;
  select 2;
end;
select 3;`;
    const r = texts(sql);
    expect(r).toHaveLength(2);
    expect(r[1]).toBe('select 3');
  });

  it('la última sentencia sin punto y coma termina en su último token', () => {
    const [a, b] = splitStatements('select 1;\nselect 2   \n');
    expect(a!.end).toBe(9);
    expect(b).toMatchObject({ text: 'select 2', startLine: 2, endLine: 2, endColumn: 9 });
  });

  it('una cadena sin cerrar llega hasta el final', () => {
    expect(texts("select 'abc; select 2")).toEqual(["select 'abc; select 2"]);
  });

  it('calcula posiciones con CRLF', () => {
    const [, b] = splitStatements('select 1;\r\n  select 2;');
    expect(b).toMatchObject({ startLine: 2, startColumn: 3 });
  });
});

describe('otros dialectos (comillas)', () => {
  it('MariaDB: backticks, comentarios # y barra invertida', () => {
    expect(splitStatements("select `a;b`, 'x\\';y' # ; c\n; select 2", 'mariadb').map((s) => s.text)).toEqual(
      ["select `a;b`, 'x\\';y'", 'select 2'],
    );
  });

  it('SQL Server: corchetes', () => {
    expect(splitStatements('select [a;b]; select 2', 'sqlserver')).toHaveLength(2);
  });
});

describe('statementAt', () => {
  const sql = 'select 1;\n\nselect 2;   \n-- comentario\nselect 3';
  const stmts = splitStatements(sql);
  const at = (needle: string, delta = 0): string | undefined =>
    statementAt(sql, stmts, sql.indexOf(needle) + delta)?.text;

  it('toma la sentencia que contiene el cursor, incluido el punto y coma', () => {
    expect(at('select 2')).toBe('select 2');
    expect(at('select 2;', 9)).toBe('select 2');
  });

  it('en una línea vacía toma la anterior', () => {
    expect(statementAt(sql, stmts, 10)?.text).toBe('select 1');
  });

  it('después del punto y coma en la misma línea toma esa sentencia', () => {
    expect(at('select 2;', 11)).toBe('select 2');
  });

  it('en una línea de comentario toma la siguiente', () => {
    expect(at('-- comentario', 3)).toBe('select 3');
  });

  it('sin sentencias devuelve undefined', () => {
    expect(statementAt('', [], 0)).toBeUndefined();
  });
});

describe('analyzeStatement', () => {
  it('distingue lectura de escritura', () => {
    expect(analyzeStatement('SELECT * FROM t').isWrite).toBe(false);
    expect(analyzeStatement('  -- x\n select 1').keyword).toBe('select');
    expect(analyzeStatement('show search_path').isWrite).toBe(false);
    expect(analyzeStatement('insert into t values (1)').isWrite).toBe(true);
    expect(analyzeStatement('create table x (a int)').isWrite).toBe(true);
    expect(analyzeStatement('select * into nueva from t').isWrite).toBe(true);
    expect(analyzeStatement('with x as (delete from t returning *) select * from x').isWrite).toBe(true);
    expect(analyzeStatement('with x as (select 1) select * from x').isWrite).toBe(false);
    expect(analyzeStatement('explain select 1').isWrite).toBe(false);
    expect(analyzeStatement('explain analyze delete from t').isWrite).toBe(true);
    expect(analyzeStatement("select 'delete'").isWrite).toBe(false);
  });

  it('detecta UPDATE/DELETE sin WHERE', () => {
    expect(analyzeStatement('delete from t').unboundedWrite).toBe(true);
    expect(analyzeStatement('update t set a = 1').unboundedWrite).toBe(true);
    expect(analyzeStatement('update t set a = 1 where id = 2').unboundedWrite).toBe(false);
    expect(analyzeStatement("update t set a = 'where'").unboundedWrite).toBe(true);
    expect(analyzeStatement('with x as (select 1) delete from t').unboundedWrite).toBe(true);
    expect(analyzeStatement('insert into t select * from u').unboundedWrite).toBe(false);
  });
});

describe('separador por línea en blanco', () => {
  const blank = (sql: string): string[] =>
    splitStatements(sql, 'postgres', { blankLineSeparator: true }).map((s) => s.text);

  it('una línea en blanco separa sentencias sin punto y coma', () => {
    expect(blank('select *\nfrom a\n\nselect 2')).toEqual(['select *\nfrom a', 'select 2']);
    expect(blank('select 1\r\n   \r\nselect 2')).toEqual(['select 1', 'select 2']);
  });

  it('el punto y coma sigue separando', () => {
    expect(blank('select 1; select 2\n\nselect 3;')).toEqual(['select 1', 'select 2', 'select 3']);
  });

  it('sin la opción, la línea en blanco no separa', () => {
    expect(texts('select *\n\nfrom a')).toEqual(['select *\n\nfrom a']);
  });

  it('no corta dentro de cadenas, comentarios de bloque, dollar quoting ni BEGIN ATOMIC', () => {
    expect(blank("select 'a\n\nb'")).toHaveLength(1);
    expect(blank('select 1 /* x\n\ny */ + 2')).toHaveLength(1);
    expect(blank('do $$\nbegin\n\n  null;\nend $$')).toHaveLength(1);
    expect(
      blank('create function f() returns int language sql\nbegin atomic\n\n  select 1;\nend'),
    ).toHaveLength(1);
  });

  it('una línea con solo un comentario no es una línea en blanco', () => {
    expect(blank('select 1\n-- comentario\nfrom a')).toHaveLength(1);
    expect(blank('select 1\n-- comentario\n\nselect 2')).toEqual(['select 1', 'select 2']);
  });

  it('statementAt elige la sentencia del bloque', () => {
    const sql = 'select 1\n\nselect 2\nfrom b';
    const stmts = splitStatements(sql, 'postgres', { blankLineSeparator: true });
    expect(statementAt(sql, stmts, sql.indexOf('from'))?.text).toBe('select 2\nfrom b');
    expect(statementAt(sql, stmts, 9)?.text).toBe('select 1');
  });
});

describe('SQL Server', () => {
  const ms = (sql: string, opts = {}): string[] => splitStatements(sql, 'sqlserver', opts).map((s) => s.text);

  it('GO termina el lote, con número y comentario opcionales, sin distinguir mayúsculas', () => {
    expect(ms('select 1\nGO\nselect 2\n  go 3 -- repetir\nselect 3')).toEqual([
      'select 1',
      'select 2',
      'select 3',
    ]);
  });

  it('GO dentro de una línea, una cadena o un comentario no separa', () => {
    expect(ms("select 'go'\n/*\ngo\n*/ select 1 as go")).toEqual(["select 'go'\n/*\ngo\n*/ select 1 as go"]);
  });

  it('el cuerpo de CREATE PROCEDURE llega hasta GO aunque tenga punto y coma y líneas en blanco', () => {
    const sql =
      'create or alter procedure dbo.p as\nset nocount on;\n\nselect 1;\nselect 2;\ngo\nexec dbo.p;';
    expect(ms(sql, { blankLineSeparator: true })).toEqual([
      'create or alter procedure dbo.p as\nset nocount on;\n\nselect 1;\nselect 2;',
      'exec dbo.p',
    ]);
  });

  it('BEGIN … END, BEGIN TRY/CATCH y CASE no se cortan; BEGIN TRAN sí es una sentencia', () => {
    const sql = `begin tran;
if @x = 1
begin
  update t set a = case when b = 1 then 2 else 3 end;
  begin try
    delete from t;
  end try
  begin catch
    print 'error';
  end catch
end;
commit;`;
    const out = ms(sql);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('begin tran');
    expect(out[1]).toMatch(/^if @x = 1[\s\S]*end catch\nend$/);
    expect(out[2]).toBe('commit');
  });
});

describe('MariaDB', () => {
  const my = (sql: string): string[] => splitStatements(sql, 'mariadb').map((s) => s.text);

  it('DELIMITER cambia el separador y la línea no es una sentencia', () => {
    const sql = `DELIMITER $$
create procedure p()
begin
  select 1;
  select 2;
end$$
DELIMITER ;
call p();`;
    expect(my(sql)).toEqual(['create procedure p()\nbegin\n  select 1;\n  select 2;\nend', 'call p()']);
  });

  it('DELIMITER de dos barras y posiciones del rango', () => {
    const [s] = splitStatements('delimiter //\nselect 1; select 2//\n', 'mariadb');
    expect(s).toMatchObject({ text: 'select 1; select 2', startLine: 2, endLine: 2, endColumn: 21 });
  });

  it('bloques BEGIN … END con IF, LOOP y CASE sin DELIMITER', () => {
    const sql = `create procedure p(n int)
begin
  if n > 0 then
    select if(n > 1, 'a', 'b');
  end if;
  l: loop
    leave l;
  end loop;
  case n when 1 then select 1; else select 2; end case;
  create table if not exists t (a int);
end;
select 3;`;
    const out = my(sql);
    expect(out).toHaveLength(2);
    expect(out[1]).toBe('select 3');
  });

  it('BEGIN al inicio es una transacción; BEGIN NOT ATOMIC es un bloque', () => {
    expect(my('begin; insert into t values (1); commit;')).toEqual([
      'begin',
      'insert into t values (1)',
      'commit',
    ]);
    expect(my('begin not atomic select 1; select 2; end; select 3')).toEqual([
      'begin not atomic select 1; select 2; end',
      'select 3',
    ]);
  });
});

describe('SQLite', () => {
  const lite = (sql: string): string[] => splitStatements(sql, 'sqlite').map((s) => s.text);

  it('el cuerpo de CREATE TRIGGER no se corta; BEGIN TRANSACTION sí es una sentencia', () => {
    const sql = `begin transaction;
create trigger tr after insert on t
begin
  update u set n = n + 1;
  insert into log values (case when new.a > 0 then 'x' else 'y' end);
end;
commit;`;
    const out = lite(sql);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('begin transaction');
    expect(out[1]).toMatch(/^create trigger[\s\S]*end$/);
  });
});

describe('analyzeStatement (otros dialectos)', () => {
  it('bloques y PRAGMA', () => {
    expect(analyzeStatement('begin tran', 'sqlserver').isWrite).toBe(false);
    expect(analyzeStatement("if exists (select 1 from t) print 'x'", 'sqlserver').isWrite).toBe(false);
    expect(analyzeStatement('if @a = 1 begin delete from t where id = 1 end', 'sqlserver').isWrite).toBe(
      true,
    );
    expect(analyzeStatement('declare @x int = 1', 'sqlserver').isWrite).toBe(false);
    expect(analyzeStatement('select * into nueva from t', 'sqlserver').isWrite).toBe(true);
    expect(analyzeStatement('pragma table_info(t)', 'sqlite').isWrite).toBe(false);
    expect(analyzeStatement('pragma journal_mode = wal', 'sqlite').isWrite).toBe(true);
    expect(analyzeStatement('show tables', 'mariadb').isWrite).toBe(false);
  });
});
