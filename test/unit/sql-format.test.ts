import { describe, expect, it } from 'vitest';
import { formatFragment, formatScript } from '../../src/renderer/features/editor/sql-format';

describe('formateo de SQL', () => {
  it('formatea cada sentencia y conserva separadores y comentarios entre ellas', () => {
    const r = formatScript('-- uno\nselect a,b from t;\n\n/* dos */ select 1', 'postgres', { tabWidth: 4 });
    expect(r.failed).toBe(0);
    expect(r.text).toBe('-- uno\nselect\n    a,\n    b\nfrom\n    t;\n\n/* dos */ select\n    1');
  });

  it('no rompe GO de SQL Server ni DELIMITER de MariaDB', () => {
    expect(formatScript('select a from t\ngo\nselect 2', 'sqlserver', { tabWidth: 2 }).text).toBe(
      'select\n  a\nfrom\n  t\ngo\nselect\n  2',
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
    expect(formatFragment('  select a from t  ', 'sqlite', 4)).toBe('  select\n    a\nfrom\n    t  ');
  });
});
