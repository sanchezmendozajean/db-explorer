import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnectionConfig } from '@shared/connection';
import { CompleteConnectionSchema, connectionAddress, newConnectionDefaults } from '@shared/connection';
import { quoteIdent, qualifiedName } from '@shared/sql-quote';
import { ConnectionStore } from '../../src/main/services/connection-store';
import type { Encryptor } from '../../src/main/services/secret-store';
import { SecretStore } from '../../src/main/services/secret-store';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dbx-conn-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const conn = (id: string, extra: Partial<ConnectionConfig> = {}): ConnectionConfig => ({
  ...newConnectionDefaults('postgres', id),
  name: `Conexión ${id}`,
  ...extra,
});

/** Cifrador de prueba: invierte y codifica, para verificar que nada queda en texto plano. */
const fakeEncryptor = (available = true): Encryptor => ({
  isAvailable: () => available,
  encrypt: (plain) => Buffer.from(Buffer.from([...plain].reverse().join(''), 'utf8').map((b) => b ^ 0x5a)),
  decrypt: (data) => [...Buffer.from(data.map((b) => b ^ 0x5a)).toString('utf8')].reverse().join(''),
});

describe('ConnectionStore', () => {
  it('guarda, relee y respalda en .bak antes de cada escritura', async () => {
    const file = join(tempDir(), 'connections.json');
    const store = new ConnectionStore(file);
    await store.load();
    await store.upsert(conn('a', { folder: 'Prod' }));
    await store.upsert(conn('b'));
    expect(existsSync(`${file}.bak`)).toBe(true);

    const reloaded = new ConnectionStore(file);
    const result = await reloaded.load();
    expect(result.connections.map((c) => c.id)).toEqual(['a', 'b']);
    expect(result.folders).toEqual(['Prod']);
    expect(result.skipped).toBe(0);
  });

  it('omite entradas inválidas o duplicadas sin perder las válidas', async () => {
    const file = join(tempDir(), 'connections.json');
    writeFileSync(
      file,
      JSON.stringify({ version: 1, folders: [], connections: [conn('ok'), { id: 'mala' }, conn('ok')] }),
    );
    const result = await new ConnectionStore(file).load();
    expect(result.connections.map((c) => c.id)).toEqual(['ok']);
    expect(result.skipped).toBe(2);
  });

  it('aparta un archivo ilegible en lugar de sobrescribirlo', async () => {
    const dir = tempDir();
    const file = join(dir, 'connections.json');
    writeFileSync(file, '{ roto');
    const result = await new ConnectionStore(file).load();
    expect(result.connections).toEqual([]);
    expect(readdirSync(dir).some((f) => f.startsWith('connections.json.invalido-'))).toBe(true);
  });

  it('reordena y mueve entre carpetas; rechaza un orden incompleto', async () => {
    const store = new ConnectionStore(join(tempDir(), 'connections.json'));
    await store.load();
    await store.upsert(conn('a'));
    await store.upsert(conn('b', { folder: 'X' }));
    await store.setLayout(
      ['X', 'Y'],
      [
        { id: 'b', folder: 'Y' },
        { id: 'a', folder: 'no-existe' },
      ],
    );
    expect(store.current.connections.map((c) => [c.id, c.folder])).toEqual([
      ['b', 'Y'],
      ['a', undefined],
    ]);
    await expect(store.setLayout([], [{ id: 'a' }])).rejects.toThrow();
  });

  it('elimina conexiones', async () => {
    const store = new ConnectionStore(join(tempDir(), 'connections.json'));
    await store.load();
    await store.upsert(conn('a'));
    await store.remove('a');
    expect(store.current.connections).toEqual([]);
  });
});

describe('SecretStore', () => {
  it('guarda cifrado: la contraseña nunca aparece en el archivo', async () => {
    const file = join(tempDir(), 'secrets.bin');
    const secrets = new SecretStore(file, fakeEncryptor());
    await secrets.set('a', 'Sup3r-Secreta!');
    expect(readFileSync(file, 'utf8')).not.toContain('Sup3r-Secreta!');

    const reloaded = new SecretStore(file, fakeEncryptor());
    await reloaded.load();
    expect(reloaded.get('a')).toBe('Sup3r-Secreta!');
    expect(reloaded.ids()).toEqual(['a']);
  });

  it('copia, borra y limpia', async () => {
    const secrets = new SecretStore(join(tempDir(), 'secrets.bin'), fakeEncryptor());
    await secrets.set('a', 'x');
    await secrets.copy('a', 'b');
    expect(secrets.get('b')).toBe('x');
    await secrets.delete('a');
    expect(secrets.has('a')).toBe(false);
    await secrets.clear();
    expect(secrets.ids()).toEqual([]);
  });

  it('sin cifrado disponible no guarda contraseñas', async () => {
    const secrets = new SecretStore(join(tempDir(), 'secrets.bin'), fakeEncryptor(false));
    expect(secrets.available).toBe(false);
    await expect(secrets.set('a', 'x')).rejects.toThrow();
  });
});

describe('modelo de conexión', () => {
  it('exige host en motores de servidor y archivo en SQLite', () => {
    expect(CompleteConnectionSchema.safeParse(conn('a', { host: '' })).success).toBe(false);
    expect(CompleteConnectionSchema.safeParse(conn('a')).success).toBe(true);
    const sqlite = { ...newConnectionDefaults('sqlite', 's'), name: 'Local' };
    expect(CompleteConnectionSchema.safeParse(sqlite).success).toBe(false);
    expect(CompleteConnectionSchema.safeParse({ ...sqlite, file: 'C:\\datos\\x.db' }).success).toBe(true);
  });

  it('muestra host:puerto, instancia o archivo', () => {
    expect(connectionAddress(conn('a', { host: 'db', port: 5432 }))).toBe('db:5432');
    expect(
      connectionAddress({
        ...newConnectionDefaults('sqlserver', 's'),
        name: 'x',
        host: 'srv',
        instance: 'SQL1',
      }),
    ).toBe('srv\\SQL1:1433');
    expect(connectionAddress({ ...newConnectionDefaults('sqlite', 'l'), name: 'x', file: 'D:\\a.db' })).toBe(
      'D:\\a.db',
    );
  });
});

describe('quoteIdent', () => {
  it('entrecomilla solo cuando hace falta, según el dialecto', () => {
    expect(quoteIdent('postgres', 'clientes')).toBe('clientes');
    expect(quoteIdent('postgres', 'CRendiciones_Conf_Generales')).toBe('"CRendiciones_Conf_Generales"');
    expect(quoteIdent('postgres', 'user')).toBe('"user"');
    expect(quoteIdent('postgres', 'a"b')).toBe('"a""b"');
    expect(quoteIdent('mariadb', 'Clientes')).toBe('Clientes');
    expect(quoteIdent('mariadb', 'mi tabla')).toBe('`mi tabla`');
    expect(quoteIdent('sqlserver', 'order')).toBe('[order]');
    expect(qualifiedName('postgres', { schema: 'public', name: 'Usuarios' })).toBe('public."Usuarios"');
    expect(qualifiedName('sqlite', { schema: 'main', name: 'x' })).toBe('x');
  });
});
