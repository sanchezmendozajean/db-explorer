import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import type { ConnectionConfig } from '@shared/connection';
import { newConnectionDefaults } from '@shared/connection';
import type { TreeNodeData } from '@shared/metadata';
import { PostgresDriver } from '../../src/db-host/drivers/postgres/postgres-driver';
import { ConnectionManager } from '../../src/db-host/connection-manager';
import { PG_FIXTURE_SQL } from './pg-server';

const server = inject('pg');

const config: ConnectionConfig = {
  ...newConnectionDefaults('postgres', 'pg-test'),
  name: 'Pruebas',
  host: server.host,
  port: server.port,
  user: server.user,
  database: server.database,
};

beforeAll(async () => {
  const client = new pg.Client(server);
  await client.connect();
  await client.query(PG_FIXTURE_SQL);
  await client.end();
});

describe('PostgresDriver', () => {
  const driver = new PostgresDriver();

  beforeAll(async () => {
    await driver.connect(config, server.password);
  });

  afterAll(() => driver.disconnect());

  it('informa producto y versión', async () => {
    const other = new PostgresDriver();
    const info = await other.connect(config, server.password);
    await other.disconnect();
    expect(info.product).toMatch(/^PostgreSQL \d+/);
    expect(info.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('lista bases y marca las plantillas como sistema', async () => {
    const dbs = await driver.listDatabases();
    const test = dbs.find((d) => d.name === server.database);
    expect(test?.detail).toMatch(/\d/);
    expect(dbs.some((d) => d.system)).toBe(true);
  });

  it('lista esquemas y marca los del sistema', async () => {
    const schemas = await driver.listSchemas(server.database);
    expect(schemas).toContainEqual({ name: 'dbx', system: false });
    expect(schemas).toContainEqual({ name: 'pg_catalog', system: true });
    expect(schemas).toContainEqual({ name: 'information_schema', system: true });
    expect(schemas.some((s) => s.name.startsWith('pg_toast'))).toBe(false);
  });

  it('cuenta y lista objetos por tipo', async () => {
    const scope = { database: server.database, schema: 'dbx' };
    expect(await driver.countObjects(scope)).toMatchObject({
      table: 2,
      view: 1,
      materializedView: 1,
      function: 1,
      procedure: 1,
    });
    expect((await driver.listObjects(scope, 'table')).map((o) => o.name)).toEqual([
      'CRendiciones_Conf_Generales',
      'clientes',
    ]);
    expect(await driver.listObjects(scope, 'function')).toEqual([
      { name: 'fn_doble(p integer)', detail: 'integer' },
    ]);
    expect((await driver.listObjects(scope, 'sequence')).map((o) => o.name)).toContain('seq_extra');
  });

  it('devuelve columnas con tipo, nulabilidad, default, PK y comentario', async () => {
    const cols = await driver.getColumns({
      database: server.database,
      schema: 'dbx',
      name: 'CRendiciones_Conf_Generales',
    });
    expect(cols.map((c) => c.name)).toEqual(['id', 'Nombre', 'ImporteLimite', 'Activo', 'FechaDeCreacion']);
    expect(cols[0]).toMatchObject({ nativeType: 'integer', primaryKey: true, nullable: false });
    expect(cols[1]).toMatchObject({
      nativeType: 'character varying(120)',
      nullable: false,
      comment: 'Nombre del parámetro',
    });
    expect(cols[2]).toMatchObject({ nativeType: 'numeric(12,2)', nullable: true, primaryKey: false });
    expect(cols[3]?.defaultValue).toBe('true');
  });

  it('devuelve índices con sus columnas', async () => {
    const idx = await driver.getIndexes({
      database: server.database,
      schema: 'dbx',
      name: 'CRendiciones_Conf_Generales',
    });
    expect(idx[0]).toMatchObject({ primary: true, unique: true, columns: ['id'] });
    expect(idx.find((i) => i.name === 'idx_conf_nombre')).toMatchObject({
      unique: false,
      columns: ['"Nombre"', '"Activo"'],
    });
  });

  it('abre otra base bajo demanda (Postgres no permite USE)', async () => {
    const schemas = await driver.listSchemas('postgres');
    expect(schemas.some((s) => s.name === 'public')).toBe(true);
  });

  it('un error de autenticación no incluye la contraseña en el mensaje', async () => {
    const bad = new PostgresDriver();
    const secret = 'contraseña-incorrecta-123';
    await expect(bad.connect(config, secret)).rejects.toThrow();
    try {
      await bad.connect(config, secret);
    } catch (err) {
      expect((err as Error).message).not.toContain(secret);
    }
    await bad.disconnect();
  });
});

describe('ConnectionManager + árbol', () => {
  const manager = new ConnectionManager();

  afterAll(() => manager.disconnectAll());

  it('prueba la conexión sin dejarla abierta', async () => {
    const info = await manager.test(config, server.password);
    expect(info.product).toMatch(/PostgreSQL/);
    expect(manager.isOpen(config.id)).toBe(false);
  });

  it('navega conexión → base → esquema → carpeta → tabla → columnas e índices', async () => {
    await manager.connect(config, server.password);
    const labels = (nodes: TreeNodeData[]): string[] => nodes.map((n) => n.label);

    const dbs = await manager.children(config.id, { kind: 'connection' });
    expect(labels(dbs)).toContain(server.database);
    expect(labels(dbs)).not.toContain('template1');

    const schemas = await manager.children(config.id, { kind: 'database', database: server.database });
    expect(labels(schemas)).toContain('dbx');
    expect(schemas.at(-1)?.ref.kind).toBe('systemSchemas');

    const folders = await manager.children(config.id, {
      kind: 'schema',
      database: server.database,
      schema: 'dbx',
    });
    expect(folders.map((f) => f.ref.kind === 'objectFolder' && [f.ref.objectKind, f.count])).toEqual([
      ['table', 2],
      ['view', 1],
      ['materializedView', 1],
      ['function', 1],
      ['procedure', 1],
      ['sequence', 2], // seq_extra + la del serial
    ]);

    const tables = await manager.children(config.id, {
      kind: 'objectFolder',
      database: server.database,
      schema: 'dbx',
      objectKind: 'table',
    });
    const table = tables.find((t) => t.label === 'CRendiciones_Conf_Generales')!;
    const columns = await manager.children(config.id, table.ref);
    expect(columns[0]).toMatchObject({ label: 'id', primaryKey: true, secondary: 'integer · NOT NULL' });
    const indexFolder = columns.at(-1)!;
    expect(indexFolder).toMatchObject({ ref: { kind: 'indexFolder' }, count: 2 });
    const indexes = await manager.children(config.id, indexFolder.ref);
    expect(labels(indexes)).toContain('idx_conf_nombre');
  });

  it('muestra las bases plantilla solo con "mostrar objetos del sistema"', async () => {
    await manager.connect({ ...config, showSystemObjects: true }, server.password);
    const dbs = await manager.children(config.id, { kind: 'connection' });
    expect(dbs.map((d) => d.label)).toContain('template1');
  });

  it('falla con un error claro si la conexión no está abierta', async () => {
    await manager.disconnect(config.id);
    await expect(manager.children(config.id, { kind: 'connection' })).rejects.toThrow(/no está abierta/);
  });
});
