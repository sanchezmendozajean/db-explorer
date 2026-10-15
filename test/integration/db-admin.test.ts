import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import type { ConnectionConfig } from '@shared/connection';
import { newConnectionDefaults } from '@shared/connection';
import { ConnectionManager } from '../../src/db-host/connection-manager';
import { AuxTools } from '../../src/main/services/aux-tools';
import { BackupRunner } from '../../src/main/services/db-backup';
import { findPgBin } from './pg-server';

const server = inject('pg');

const config: ConnectionConfig = {
  ...newConnectionDefaults('postgres', 'pg-admin'),
  name: 'Administración',
  host: server.host,
  port: server.port,
  user: server.user,
  database: server.database,
};

const names = ['dbx_admin_a', 'dbx_admin_b', 'dbx_admin_c'];

async function withClient<T>(database: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ ...server, database });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const exists = (name: string): Promise<boolean> =>
  withClient(server.database, async (c) => {
    const r = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    return r.rowCount === 1;
  });

describe('PostgreSQL: crear, renombrar y eliminar bases', () => {
  const manager = new ConnectionManager();

  beforeAll(async () => {
    await manager.connect(config, server.password);
    for (const n of names) {
      await withClient(server.database, (c) => c.query(`DROP DATABASE IF EXISTS ${n} WITH (FORCE)`));
    }
  });

  afterAll(async () => {
    await manager.disconnectAll();
    for (const n of names) {
      await withClient(server.database, (c) => c.query(`DROP DATABASE IF EXISTS ${n} WITH (FORCE)`));
    }
  });

  it('crea, renombra y elimina una base, aunque haya conexiones abiertas a ella', async () => {
    await manager.createDatabase('pg-admin', 'dbx_admin_a');
    expect(await exists('dbx_admin_a')).toBe(true);

    // Una conexión ajena y la de metadatos del programa abiertas contra la base.
    const intruder = new pg.Client({ ...server, database: 'dbx_admin_a' });
    await intruder.connect();
    intruder.on('error', () => undefined);
    await manager.children('pg-admin', { kind: 'database', database: 'dbx_admin_a' });

    await manager.renameDatabase('pg-admin', 'dbx_admin_a', 'dbx_admin_b');
    expect(await exists('dbx_admin_a')).toBe(false);
    expect(await exists('dbx_admin_b')).toBe(true);

    await manager.dropDatabase('pg-admin', 'dbx_admin_b');
    expect(await exists('dbx_admin_b')).toBe(false);
    await intruder.end().catch(() => undefined);
  });

  it('rechaza nombres vacíos, bases del sistema y la base de la conexión', async () => {
    await expect(manager.createDatabase('pg-admin', '  ')).rejects.toThrow(/no es válido/);
    await expect(manager.dropDatabase('pg-admin', 'template1')).rejects.toThrow(/del sistema/);
    await expect(manager.dropDatabase('pg-admin', server.database)).rejects.toThrow(
      /(base a la que está conectada|del sistema)/,
    );
  });

  it('informa el error del servidor si la base ya existe', async () => {
    await manager.createDatabase('pg-admin', 'dbx_admin_c');
    await expect(manager.createDatabase('pg-admin', 'dbx_admin_c')).rejects.toThrow(
      /already exists|ya existe/i,
    );
  });

  it('no modifica el servidor en una conexión de solo lectura', async () => {
    const ro = new ConnectionManager();
    await ro.connect({ ...config, id: 'pg-ro', readOnly: true }, server.password);
    await expect(ro.createDatabase('pg-ro', 'dbx_admin_x')).rejects.toThrow(/solo lectura/);
    await expect(ro.dropDatabase('pg-ro', 'dbx_admin_c')).rejects.toThrow(/solo lectura/);
    await ro.disconnectAll();
  });
});

const bin = findPgBin();

describe.skipIf(!bin || !existsSync(join(bin, 'pg_dump.exe')))(
  'PostgreSQL: respaldo y restauración con pg_dump',
  () => {
    let scratch: string;
    let tools: AuxTools;
    let runner: BackupRunner;
    const db = 'dbx_admin_bk';

    beforeAll(async () => {
      scratch = await mkdtemp(join(tmpdir(), 'dbx-bk-'));
      tools = new AuxTools(join(scratch, 'tools'));
      runner = new BackupRunner(tools);
      await withClient(server.database, (c) => c.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`));
      await withClient(server.database, (c) => c.query(`CREATE DATABASE ${db}`));
      await withClient(db, async (c) => {
        await c.query('CREATE TABLE cliente (id int PRIMARY KEY, nombre text)');
        await c.query("INSERT INTO cliente VALUES (1, 'Ana'), (2, 'Luis')");
      });
    });

    afterAll(async () => {
      await withClient(server.database, (c) => c.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`));
      await rm(scratch, { recursive: true, force: true });
    });

    const count = (): Promise<number> =>
      withClient(db, async (c) =>
        Number((await c.query('SELECT count(*)::int AS n FROM cliente')).rows[0].n),
      );

    it('importa los binarios, copia sus DLL y lee la versión', async () => {
      const result = await tools.import('postgres', [
        join(bin!, 'pg_dump.exe'),
        join(bin!, 'pg_restore.exe'),
      ]);
      expect(result.rejected).toEqual([]);
      expect(result.status.files.map((f) => f.installed)).toEqual([true, true]);
      expect(result.status.files[0]!.version).toMatch(/^\d+/);
      // libpq.dll viene de la tabla de importación del ejecutable, no de una lista fija.
      expect(existsSync(join(tools.dir('postgres'), 'libpq.dll'))).toBe(true);
      // La lista informa las bibliotecas que necesita y que ya están copiadas.
      const libs = result.status.files[0]!.libraries ?? [];
      expect(libs.find((l) => l.name.toLowerCase() === 'libpq.dll')?.installed).toBe(true);
      expect(libs.every((l) => l.installed)).toBe(true);
      // Recuerda la carpeta de origen para abrir el selector ahí la próxima vez.
      expect(await tools.lastSourceDir('postgres')).toBe(bin);
    });

    it('si faltan bibliotecas junto al ejecutable, dice cuáles', async () => {
      const lonely = join(scratch, 'solo');
      await mkdir(lonely);
      await copyFile(join(bin!, 'pg_dump.exe'), join(lonely, 'pg_dump.exe'));
      const result = await new AuxTools(join(scratch, 'tools3')).import('postgres', [
        join(lonely, 'pg_dump.exe'),
      ]);
      expect(result.rejected[0]!.reason).toMatch(/Faltan: .*libpq.dll/i);
      const file = result.status.files[0]!;
      expect(file.installed).toBe(false);
      expect(file.libraries?.find((l) => l.name.toLowerCase() === 'libpq.dll')?.installed).toBe(false);
    });

    it('reconoce una copia de seguridad de la carpeta de herramientas, aunque no traiga el manifiesto', async () => {
      const restored = join(scratch, 'restaurado');
      await cp(tools.dir('postgres'), join(restored, 'postgres'), { recursive: true });
      await rm(join(restored, 'postgres', 'manifest.json'));
      const status = await new AuxTools(restored).status('postgres');
      expect(status.files.map((f) => f.installed)).toEqual([true, true]);
      expect(status.files[0]!.version).toMatch(/^\d+/);
      expect(status.files[0]!.libraries?.some((l) => l.name.toLowerCase() === 'libpq.dll')).toBe(true);
    });

    it('rechaza archivos equivocados o de otra familia', async () => {
      const wrongName = await tools.import('mysql', [join(bin!, 'pg_dump.exe')]);
      expect(wrongName.rejected[0]!.reason).toMatch(/esperados/);
      const notExecutable = join(scratch, 'pg_restore.exe');
      await import('node:fs/promises').then((fs) => fs.writeFile(notExecutable, 'no soy un ejecutable'));
      const bad = await new AuxTools(join(scratch, 'tools2')).import('postgres', [notExecutable]);
      expect(bad.rejected[0]!.reason).toMatch(/ejecutable válido/);
      expect(bad.status.files.every((f) => !f.installed)).toBe(true);
    });

    it('respalda y restaura una base (la restauración deshace los cambios posteriores)', async () => {
      const file = join(scratch, 'bk.backup');
      const job = {
        family: 'postgres' as const,
        config,
        secret: server.password,
        database: db,
        file,
      };
      const made = await runner.run('op-1', { ...job, kind: 'backup' });
      expect(made.bytes).toBeGreaterThan(0);
      expect((await readFile(file)).subarray(0, 5).toString()).toBe('PGDMP');

      await withClient(db, (c) => c.query('DELETE FROM cliente'));
      expect(await count()).toBe(0);

      await runner.run('op-2', { ...job, kind: 'restore' });
      expect(await count()).toBe(2);
    });

    it('informa el motivo cuando la herramienta falla y no deja el archivo a medias', async () => {
      const file = join(scratch, 'malo.backup');
      await expect(
        runner.run('op-3', {
          family: 'postgres',
          kind: 'backup',
          config,
          secret: server.password,
          database: 'no_existe',
          file,
        }),
      ).rejects.toThrow(/no_existe/);
      expect(existsSync(file)).toBe(false);
    });

    it('no filtra la contraseña en el mensaje de error', async () => {
      const file = join(scratch, 'pw.backup');
      const secret = 'contraseña-equivocada';
      const error = await runner
        .run('op-4', { family: 'postgres', kind: 'backup', config, secret, database: db, file })
        .catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(secret);
    });

    it('cancela una operación en curso', async () => {
      const file = join(scratch, 'cancel.backup');
      const pending = runner.run('op-5', {
        family: 'postgres',
        kind: 'backup',
        config,
        secret: server.password,
        database: db,
        file,
      });
      runner.cancel('op-5');
      await expect(pending).rejects.toMatchObject({ cancelled: true });
      expect(existsSync(file)).toBe(false);
    });
  },
);
