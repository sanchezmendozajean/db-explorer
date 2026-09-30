import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_UI_STATE, parseUiState } from '@shared/ui-state';
import { UiStateStore } from '../../src/main/services/ui-state-store';
import { writeFileAtomic } from '../../src/main/services/fs-atomic';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dbx-unit-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('parseUiState', () => {
  it('devuelve los valores por defecto para entradas vacías o inválidas', () => {
    expect(parseUiState(undefined)).toEqual(DEFAULT_UI_STATE);
    expect(parseUiState('basura')).toEqual(DEFAULT_UI_STATE);
  });

  it('recupera los campos válidos de un archivo parcialmente dañado', () => {
    const state = parseUiState({
      theme: 'light',
      sideBar: { visible: 'no', view: 'files' },
      layout: { main: { sidebar: 20, 'editor-area': 80 }, editor: 'x' },
    });
    expect(state.theme).toBe('light');
    expect(state.sideBar).toEqual({ visible: true, view: 'files' });
    expect(state.layout).toEqual({ main: { sidebar: 20, 'editor-area': 80 }, editor: null });
    expect(state.panel).toEqual(DEFAULT_UI_STATE.panel);
  });

  it('rechaza porcentajes fuera de rango', () => {
    expect(parseUiState({ layout: { main: { sidebar: 150 } } }).layout.main).toBeNull();
  });
});

describe('UiStateStore', () => {
  it('usa valores por defecto si el archivo no existe o es JSON inválido', async () => {
    const dir = tempDir();
    expect(await new UiStateStore(join(dir, 'no-existe.json')).load()).toEqual(DEFAULT_UI_STATE);
    writeFileSync(join(dir, 'roto.json'), '{ no es json');
    expect(await new UiStateStore(join(dir, 'roto.json')).load()).toEqual(DEFAULT_UI_STATE);
  });

  it('guarda y vuelve a leer, conservando la última escritura', async () => {
    const file = join(tempDir(), 'ui-state.json');
    const store = new UiStateStore(file);
    const a = { ...DEFAULT_UI_STATE, theme: 'dark' as const };
    const b = { ...DEFAULT_UI_STATE, theme: 'light' as const };
    await Promise.all([store.save(a), store.save(b)]);
    expect(JSON.parse(readFileSync(file, 'utf8')).theme).toBe('light');
    expect((await new UiStateStore(file).load()).theme).toBe('light');
  });
});

describe('writeFileAtomic', () => {
  it('crea carpetas, escribe y no deja temporales', async () => {
    const dir = tempDir();
    const file = join(dir, 'sub', 'datos.json');
    await writeFileAtomic(file, '{"a":1}');
    await writeFileAtomic(file, '{"a":2}');
    expect(readFileSync(file, 'utf8')).toBe('{"a":2}');
    expect(readdirSync(join(dir, 'sub'))).toEqual(['datos.json']);
  });
});
