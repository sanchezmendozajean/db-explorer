import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { WorkspaceService, safeBaseName } from '../../src/main/services/workspace-service';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dbx-export-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('exportaciones al espacio de trabajo (diagrama SVG)', () => {
  async function setup() {
    const root = join(tempDir(), 'DB Explorer');
    const ws = new WorkspaceService(tempDir(), root);
    await ws.open(null);
    return { ws, root };
  }

  it('crea el archivo en la raíz del espacio con el contenido pedido', async () => {
    const { ws, root } = await setup();
    const path = await ws.saveExport('Diagrama-main', 'svg', '<svg/>');
    expect(dirname(path)).toBe(root);
    expect(basename(path)).toBe('Diagrama-main.svg');
    expect(readFileSync(path, 'utf8')).toBe('<svg/>');
  });

  it('nunca sobrescribe: agrega -2, -3…', async () => {
    const { ws } = await setup();
    const first = await ws.saveExport('Diagrama-main', 'svg', 'uno');
    const second = await ws.saveExport('Diagrama-main', 'svg', 'dos');
    const third = await ws.saveExport('Diagrama-main', 'svg', 'tres');
    expect([first, second, third].map((p) => basename(p))).toEqual([
      'Diagrama-main.svg',
      'Diagrama-main-2.svg',
      'Diagrama-main-3.svg',
    ]);
    expect(readFileSync(first, 'utf8')).toBe('uno');
    expect(readFileSync(third, 'utf8')).toBe('tres');
  });

  it('reemplaza por _ los caracteres que Windows no admite y no deja punto final', async () => {
    const { ws, root } = await setup();
    expect(safeBaseName('Diagrama-a/b:c*d?')).toBe('Diagrama-a_b_c_d_');
    expect(safeBaseName('mi base. ')).toBe('mi base');
    expect(safeBaseName('...')).toBe('Exportación');
    const path = await ws.saveExport('Diagrama-ventas\\2026|v1', 'svg', 'x');
    expect(basename(path)).toBe('Diagrama-ventas_2026_v1.svg');
    expect(existsSync(join(root, 'Diagrama-ventas_2026_v1.svg'))).toBe(true);
  });
});
