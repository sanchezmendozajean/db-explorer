import { describe, expect, it } from 'vitest';
import { parseWindowState, resolveWindowBounds } from '../../src/main/windows/window-bounds';

const main = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: 1920, y: 0, width: 1920, height: 1040 };

describe('parseWindowState', () => {
  it('acepta un estado válido y rechaza datos dañados', () => {
    expect(parseWindowState({ x: 10, y: 20, width: 1200, height: 800, maximized: true })).toEqual({
      x: 10,
      y: 20,
      width: 1200,
      height: 800,
      maximized: true,
    });
    expect(parseWindowState({ x: 'a', y: 0, width: 1, height: 1 })).toBeNull();
    expect(parseWindowState(null)).toBeNull();
  });
});

describe('resolveWindowBounds', () => {
  it('sin estado guardado usa el tamaño por defecto, sin posición', () => {
    expect(resolveWindowBounds(null, [main])).toEqual({
      bounds: { width: 1400, height: 900 },
      maximized: false,
    });
  });

  it('restaura posición, tamaño y maximizada si caben en un monitor', () => {
    const saved = { x: 2000, y: 100, width: 1300, height: 800, maximized: true };
    expect(resolveWindowBounds(saved, [main, second])).toEqual({
      bounds: { x: 2000, y: 100, width: 1300, height: 800 },
      maximized: true,
    });
  });

  it('si el monitor ya no está, abre con el tamaño por defecto y centrada', () => {
    const saved = { x: 2000, y: 100, width: 1300, height: 800, maximized: false };
    expect(resolveWindowBounds(saved, [main])).toEqual({
      bounds: { width: 1400, height: 900 },
      maximized: false,
    });
  });

  it('reduce el tamaño al área visible sin bajar del mínimo', () => {
    const small = { x: 0, y: 0, width: 1366, height: 728 };
    const saved = { x: 0, y: 0, width: 1400, height: 900, maximized: false };
    const { bounds } = resolveWindowBounds(saved, [small]);
    expect(bounds).toEqual({ x: 0, y: 0, width: 1366, height: 728 });
  });

  it('desplaza la ventana que sobresale del monitor', () => {
    const saved = { x: 1000, y: 500, width: 1300, height: 800, maximized: false };
    const { bounds } = resolveWindowBounds(saved, [main]);
    expect(bounds).toEqual({ x: 620, y: 240, width: 1300, height: 800 });
  });
});
