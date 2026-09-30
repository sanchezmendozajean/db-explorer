import { describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../../src/renderer/commands/registry';
import { fuzzyMatch } from '../../src/renderer/features/palette/fuzzy';

describe('CommandRegistry', () => {
  it('registra, ejecuta y elimina comandos', async () => {
    const reg = new CommandRegistry();
    const run = vi.fn();
    const dispose = reg.register({ id: 'db.x', run });
    expect(await reg.execute('db.x')).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    dispose();
    expect(reg.has('db.x')).toBe(false);
    expect(await reg.execute('db.x')).toBe(false);
  });

  it('no ejecuta comandos deshabilitados', async () => {
    const reg = new CommandRegistry();
    const run = vi.fn();
    reg.register({ id: 'db.y', run, enabled: () => false });
    expect(reg.isEnabled('db.y')).toBe(false);
    expect(await reg.execute('db.y')).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('notifica cambios a los suscriptores', () => {
    const reg = new CommandRegistry();
    const listener = vi.fn();
    reg.subscribe(listener);
    reg.registerMany([
      { id: 'a', run: () => undefined },
      { id: 'b', run: () => undefined },
    ])();
    expect(listener).toHaveBeenCalledTimes(4);
  });
});

describe('fuzzyMatch', () => {
  it('encuentra subcadenas sin distinguir mayúsculas y devuelve el rango', () => {
    expect(fuzzyMatch('rendic', 'CRendiciones_Conf_Generales')).toMatchObject({ ranges: [[1, 7]] });
  });

  it('prefiere coincidencias al inicio', () => {
    const a = fuzzyMatch('rend', 'Rendiciones_Historial')!;
    const b = fuzzyMatch('rend', 'ControlesDeRendiciones')!;
    expect(a.score).toBeGreaterThan(b.score);
  });

  it('acepta subsecuencias y rechaza lo que no coincide', () => {
    expect(fuzzyMatch('tbl', 'Mostrar/ocultar tabla')?.ranges.length).toBeGreaterThan(0);
    expect(fuzzyMatch('xyz', 'Usuarios')).toBeNull();
  });

  it('una búsqueda vacía coincide con todo', () => {
    expect(fuzzyMatch('', 'lo que sea')).toEqual({ score: 0, ranges: [] });
  });
});
