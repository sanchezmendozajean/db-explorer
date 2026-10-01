import { describe, expect, it } from 'vitest';
import { copyName, invalidFileName, isTextFile, withDefaultExtension } from '@shared/workspace';

describe('nombres de archivo', () => {
  it('valida con las reglas de Windows', () => {
    expect(invalidFileName('ventas.sql')).toBeNull();
    expect(invalidFileName('  ')).toMatch(/nombre/);
    expect(invalidFileName('a/b')).toMatch(/no puede contener/);
    expect(invalidFileName('a\\b')).toMatch(/no puede contener \\ \//);
    expect(invalidFileName('fin.')).toMatch(/terminar/);
    expect(invalidFileName('nul.txt')).toMatch(/reservado/);
  });

  it('sugiere .sql si no hay extensión', () => {
    expect(withDefaultExtension('reporte')).toBe('reporte.sql');
    expect(withDefaultExtension('notas.md')).toBe('notas.md');
  });

  it('nombres de copia', () => {
    const taken = new Set(['a.sql', 'a copia.sql']);
    expect(copyName('a.sql', (n) => taken.has(n))).toBe('a copia 2.sql');
    expect(copyName('b.sql', (n) => taken.has(n))).toBe('b.sql');
    expect(copyName('carpeta', () => false)).toBe('carpeta');
  });

  it('archivos de texto que se abren en el editor', () => {
    expect(isTextFile('x.SQL')).toBe(true);
    expect(isTextFile('datos.csv')).toBe(true);
    expect(isTextFile('foto.png')).toBe(false);
    expect(isTextFile('sql')).toBe(false);
  });
});
