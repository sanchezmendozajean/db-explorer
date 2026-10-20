import { describe, expect, it } from 'vitest';
import {
  formatFragment,
  formatScript,
  inlineFromClause,
  statementRangeAt,
} from '../../src/renderer/features/editor/sql-format';

describe('formateo de SQL', () => {
  it('formatea cada sentencia y conserva separadores y comentarios entre ellas', () => {
    const r = formatScript('-- uno\nselect a,b from t;\n\n/* dos */ select 1', 'postgres', { tabWidth: 4 });
    expect(r.failed).toBe(0);
    expect(r.text).toBe('-- uno\nselect\n    a,\n    b\nfrom t;\n\n/* dos */ select\n    1');
  });

  it('no rompe GO de SQL Server ni DELIMITER de MariaDB', () => {
    expect(formatScript('select a from t\ngo\nselect 2', 'sqlserver', { tabWidth: 2 }).text).toBe(
      'select\n  a\nfrom t\ngo\nselect\n  2',
    );
    const my = formatScript('DELIMITER $$\nselect 1; select 2$$\nDELIMITER ;\nselect 3;', 'mariadb', {
      tabWidth: 2,
    });
    expect(my.text.startsWith('DELIMITER $$\n')).toBe(true);
    expect(my.text).toContain('$$\nDELIMITER ;\nselect\n  3;');
  });

  it('deja como estaba una sentencia que no se puede analizar', () => {
    const r = formatScript('select ((( from;\nselect 1;', 'postgres', { tabWidth: 4 });
    expect(r.failed).toBe(1);
    expect(r.text.startsWith('select ((( from;')).toBe(true);
  });

  it('formatea una selección conservando los espacios de alrededor', () => {
    expect(formatFragment('  select a from t  ', 'sqlite', 4)).toBe('  select\n    a\nfrom t  ');
  });

  it('deja la tabla junto al from y los join sin sangría', () => {
    const sql =
      'select t1.Itemcode Codigo, t1.itemname Nombre from oitm t1 ' +
      'join OITB t2 on t1.itmsgrpcod = t2.itmsgrpcod and t1.b = t2.b left join x on x.a = t1.a where t1.a = 1';
    expect(formatFragment(sql, 'sqlserver', 4)).toBe(
      'select\n    t1.Itemcode Codigo,\n    t1.itemname Nombre\nfrom oitm t1\n' +
        'join OITB t2 on t1.itmsgrpcod = t2.itmsgrpcod\n    and t1.b = t2.b\nleft join x on x.a = t1.a\nwhere\n    t1.a = 1',
    );
  });

  it('ajusta el FROM de una subconsulta y conserva la sangría de una lista con comas', () => {
    expect(
      inlineFromClause(
        'select\n  a\nfrom\n  (\n    select\n      b\n    from\n      c\n  ) x\n  join d on d.b = x.b',
        2,
      ),
    ).toBe('select\n  a\nfrom (\n  select\n    b\n  from c\n) x\njoin d on d.b = x.b');
    expect(inlineFromClause('select\n  a\nfrom\n  t1,\n  t2', 2)).toBe('select\n  a\nfrom t1,\n  t2');
  });
});

describe('sentencia bajo el cursor', () => {
  it('devuelve el rango de la sentencia que contiene el cursor', () => {
    const text = 'select 1;\nselect a from t;\nselect 3;';
    const range = statementRangeAt(text, text.indexOf('from'), 'postgres');
    expect(range).toBeDefined();
    expect(text.slice(range!.start, range!.end)).toMatch(/^select a from t;?$/);
  });
});
