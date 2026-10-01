import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, parseSettings, validateSetting } from '@shared/settings';
import { parseWorkspaceState } from '@shared/workspace';
import { SettingsStore } from '../../src/main/services/settings-store';
import {
  FileAccessError,
  FileConflictError,
  FileExistsError,
  InvalidNameError,
  WorkspaceService,
} from '../../src/main/services/workspace-service';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dbx-ws-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('settings.json', () => {
  it('conserva las claves válidas, ignora las inválidas y pasa editor.* a Monaco', () => {
    const s = parseSettings({
      'files.autoSave': false,
      'files.autoSaveDelay': 'rápido',
      'results.maxRows': 1000,
      'editor.fontSize': 15,
      desconocida: 1,
    });
    expect(s['files.autoSave']).toBe(false);
    expect(s['files.autoSaveDelay']).toBe(DEFAULT_SETTINGS['files.autoSaveDelay']);
    expect(s['results.maxRows']).toBe(1000);
    expect(s.editor).toEqual({ fontSize: 15 });
    expect(parseSettings('basura')).toEqual(DEFAULT_SETTINGS);
    expect(validateSetting('files.autoSave', 'sí')).toBe(false);
    expect(validateSetting('nada', 1)).toBe(false);
  });

  it('modifica una clave conservando los comentarios del archivo', async () => {
    const file = join(tempDir(), 'settings.json');
    writeFileSync(file, '{\n  // mi comentario\n  "results.maxRows": 100,\n}\n');
    const store = new SettingsStore(file);
    expect((await store.load())['results.maxRows']).toBe(100);
    const updated = await store.update('files.autoSave', false);
    expect(updated['files.autoSave']).toBe(false);
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('// mi comentario');
    expect(text).toContain('"files.autoSave": false');
    await store.update('files.autoSave', undefined);
    expect(readFileSync(file, 'utf8')).not.toContain('files.autoSave');
  });
});

describe('WorkspaceService', () => {
  async function setup() {
    const userData = tempDir();
    const root = join(tempDir(), 'DB Explorer');
    const ws = new WorkspaceService(userData, root);
    const info = await ws.open(null);
    return { ws, root, userData, info };
  }

  it('crea el espacio predeterminado; si el configurado no existe lo informa sin abrirlo', async () => {
    const { root, info, ws } = await setup();
    expect(existsSync(root)).toBe(true);
    expect(info).toMatchObject({ path: root, name: 'DB Explorer', state: null, missing: [] });
    const missing = join(root, 'no-existe');
    expect(await ws.open(missing)).toMatchObject({ path: missing, unavailable: true });
    expect(ws.root).toBe(root);
    // "Usar el predeterminado" abre el de siempre sin cambiar la configuración.
    expect((await ws.open(missing, { useDefault: true })).path).toBe(root);
  });

  it('recuerda los espacios recientes (el último primero, sin duplicados)', async () => {
    const { ws, root } = await setup();
    const other = tempDir();
    await ws.open(other);
    await ws.open(root);
    expect(await ws.recent()).toEqual([root, other]);
  });

  it('crea Script-N.sql con el menor número libre', async () => {
    const { ws, root } = await setup();
    expect(await ws.newScript()).toBe(join(root, 'Script-1.sql'));
    writeFileSync(join(root, 'Script-3.sql'), 'x');
    expect(await ws.newScript()).toBe(join(root, 'Script-2.sql'));
    expect(await ws.newScript()).toBe(join(root, 'Script-4.sql'));
  });

  it('lee y guarda conservando BOM y fin de línea', async () => {
    const { ws, root } = await setup();
    const path = join(root, 'con-bom.sql');
    writeFileSync(
      path,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('select 1;\r\nselect 2;')]),
    );
    const file = await ws.readScript(path);
    expect(file).toMatchObject({ content: 'select 1;\r\nselect 2;', bom: true, eol: 'CRLF' });
    await ws.writeScript(path, 'select ñ;\r\n', { bom: true, expectedMtimeMs: file.mtimeMs });
    const raw = readFileSync(path);
    expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(raw.subarray(3).toString('utf8')).toBe('select ñ;\r\n');
  });

  it('no sobrescribe un archivo que cambió en disco, salvo que se fuerce', async () => {
    const { ws, root } = await setup();
    const path = join(root, 'externo.sql');
    writeFileSync(path, 'original');
    const { mtimeMs } = await ws.readScript(path);
    writeFileSync(path, 'cambio externo');
    utimesSync(path, new Date(), new Date(Date.now() + 5000));
    await expect(
      ws.writeScript(path, 'mío', { bom: false, expectedMtimeMs: mtimeMs }),
    ).rejects.toBeInstanceOf(FileConflictError);
    expect(readFileSync(path, 'utf8')).toBe('cambio externo');
    await ws.writeScript(path, 'mío', { bom: false, expectedMtimeMs: mtimeMs, force: true });
    expect(readFileSync(path, 'utf8')).toBe('mío');
  });

  it('solo opera dentro del espacio de trabajo', async () => {
    const { ws, root } = await setup();
    const outside = join(tempDir(), 'fuera.sql');
    writeFileSync(outside, 'x');
    await expect(ws.readScript(outside)).rejects.toBeInstanceOf(FileAccessError);
    await expect(ws.readScript(join(root, '..', 'fuera.sql'))).rejects.toBeInstanceOf(FileAccessError);
    await expect(ws.writeScript('relativo.sql', 'x', { bom: false })).rejects.toBeInstanceOf(FileAccessError);
    expect(ws.contains(join(root.toUpperCase(), 'a.sql'))).toBe(process.platform === 'win32');
  });

  it('elimina un script solo si está vacío', async () => {
    const { ws, root } = await setup();
    const empty = join(root, 'vacio.sql');
    const full = join(root, 'lleno.sql');
    writeFileSync(empty, '  \n\t');
    writeFileSync(full, 'select 1');
    expect(await ws.deleteIfEmpty(empty)).toBe(true);
    expect(await ws.deleteIfEmpty(full)).toBe(false);
    expect(existsSync(empty)).toBe(false);
    expect(existsSync(full)).toBe(true);
  });

  it('guarda el estado fuera de la carpeta, con rutas relativas', async () => {
    const { ws, root, userData } = await setup();
    const file = join(root, 'sub', 'Script-1.sql');
    mkdirSync(join(root, 'sub'));
    writeFileSync(file, '');
    await ws.saveState({
      path: root,
      tabs: [
        { type: 'script', file: ws.toStatePath(file), connectionId: 'c1' },
        { type: 'script', file: 'borrado.sql' },
      ],
      activeTab: 1,
    });
    const reopened = await new WorkspaceService(userData, root).open(null);
    expect(reopened.state?.tabs).toHaveLength(1);
    expect(reopened.state?.tabs[0]).toMatchObject({ file: join('sub', 'Script-1.sql'), connectionId: 'c1' });
    expect(reopened.state?.activeTab).toBe(0);
    expect(reopened.missing).toEqual(['borrado.sql']);
    expect(ws.resolve(reopened.state!.tabs[0]!.file)).toBe(file);
  });

  it('recupera las pestañas válidas de un estado dañado', () => {
    expect(
      parseWorkspaceState({
        tabs: [{ type: 'script', file: 'a.sql' }, { type: 'otra' }, { type: 'script' }],
        activeTab: 7,
      }),
    ).toMatchObject({ tabs: [{ file: 'a.sql' }], activeTab: 0 });
    expect(parseWorkspaceState(null)).toBeNull();
  });
});

describe('operaciones de la vista Archivos', () => {
  async function setup() {
    const root = join(tempDir(), 'DB Explorer');
    const trashed: string[] = [];
    const ws = new WorkspaceService(tempDir(), root, async (p) => {
      trashed.push(p);
      rmSync(p, { recursive: true, force: true });
    });
    await ws.open(null);
    return { ws, root, trashed };
  }

  it('lista carpetas primero, sin los excluidos ni los temporales', async () => {
    const { ws, root } = await setup();
    mkdirSync(join(root, 'zeta'));
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, 'a.sql'), '');
    writeFileSync(join(root, 'b.sql.1a2b.tmp'), '');
    writeFileSync(join(root, '.env'), '');
    expect((await ws.listDir(root)).map((n) => n.name)).toEqual(['zeta', '.env', 'a.sql']);
  });

  it('crea, renombra (también solo mayúsculas) y valida nombres', async () => {
    const { ws, root } = await setup();
    const dir = await ws.create(root, 'consultas', 'folder');
    const file = await ws.create(dir, 'ventas.sql', 'file');
    expect(existsSync(file)).toBe(true);
    await expect(ws.create(dir, 'ventas.sql', 'file')).rejects.toBeInstanceOf(FileExistsError);
    await expect(ws.create(dir, 'a:b.sql', 'file')).rejects.toBeInstanceOf(InvalidNameError);
    await expect(ws.create(dir, 'CON', 'file')).rejects.toBeInstanceOf(InvalidNameError);
    const renamed = await ws.rename(file, 'Ventas.sql');
    expect(renamed).toBe(join(dir, 'Ventas.sql'));
    await ws.create(dir, 'otro.sql', 'file');
    await expect(ws.rename(renamed, 'otro.sql')).rejects.toBeInstanceOf(FileExistsError);
  });

  it('mueve, copia con sufijo " copia" y no mete una carpeta dentro de sí misma', async () => {
    const { ws, root } = await setup();
    const dir = await ws.create(root, 'carpeta', 'folder');
    const file = await ws.create(root, 'x.sql', 'file');
    expect(await ws.move([file], dir)).toEqual([{ from: file, to: join(dir, 'x.sql') }]);
    const copies = await ws.copy([join(dir, 'x.sql'), join(dir, 'x.sql')], dir);
    expect(copies).toEqual([join(dir, 'x copia.sql'), join(dir, 'x copia 2.sql')]);
    await expect(ws.move([dir], dir)).rejects.toBeInstanceOf(FileAccessError);
    await expect(ws.copy([dir], join(dir))).rejects.toBeInstanceOf(FileAccessError);
  });

  it('elimina enviando a la papelera y nunca fuera del espacio', async () => {
    const { ws, root, trashed } = await setup();
    const file = await ws.create(root, 'borrar.sql', 'file');
    await ws.trash([file]);
    expect(trashed).toEqual([file]);
    await expect(ws.trash([root])).rejects.toBeInstanceOf(FileAccessError);
    await expect(ws.trash([join(root, '..', 'fuera.sql')])).rejects.toBeInstanceOf(FileAccessError);
    await expect(ws.listDir(join(root, '..'))).rejects.toBeInstanceOf(FileAccessError);
  });

  it('lee y guarda archivos de fuera del espacio solo si se eligieron con el diálogo', async () => {
    const { ws } = await setup();
    const outside = join(tempDir(), 'externo.sql');
    writeFileSync(outside, 'select 1;');
    await expect(ws.readScript(outside)).rejects.toBeInstanceOf(FileAccessError);
    ws.allow(outside);
    expect((await ws.readScript(outside)).content).toBe('select 1;');
  });
});
