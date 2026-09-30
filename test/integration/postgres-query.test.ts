import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import pg from 'pg';
import type { ConnectionConfig } from '@shared/connection';
import { newConnectionDefaults } from '@shared/connection';
import type { ExecuteRequest, QueryEvent } from '@shared/query';
import { ConnectionManager } from '../../src/db-host/connection-manager';
import { defaultDriverFactory } from '../../src/db-host/connection-manager';
import { PG_FIXTURE_SQL } from './pg-server';

const server = inject('pg');

const config: ConnectionConfig = {
  ...newConnectionDefaults('postgres', 'pg-query'),
  name: 'Pruebas de ejecución',
  host: server.host,
  port: server.port,
  user: server.user,
  database: server.database,
};

const events: QueryEvent[] = [];
const manager = new ConnectionManager(defaultDriverFactory, (e) => events.push(e));
let nextId = 1;

function request(statements: string[], extra: Partial<ExecuteRequest> = {}): ExecuteRequest {
  return {
    queryId: `q${nextId++}`,
    sessionId: 'tab-1',
    connectionId: config.id,
    statements,
    maxRows: 500,
    ...extra,
  };
}

function eventsOf<T extends QueryEvent['type']>(queryId: string, type: T): Extract<QueryEvent, { type: T }>[] {
  return events.filter((e): e is Extract<QueryEvent, { type: T }> => e.type === type && e.queryId === queryId);
}

function rowsOf(queryId: string, index = 0): unknown[][] {
  return eventsOf(queryId, 'rows')
    .filter((e) => e.index === index)
    .flatMap((e) => e.rows);
}

beforeAll(async () => {
  const client = new pg.Client(server);
  await client.connect();
  await client.query(PG_FIXTURE_SQL);
  await client.query(`
    CREATE TABLE dbx.tipos (
      id int PRIMARY KEY, importe numeric(20,6), grande bigint, real8 float8, activo boolean,
      creado timestamp(3), creado_tz timestamptz, dia date, datos jsonb, bin bytea, u uuid, t text
    );
    INSERT INTO dbx.tipos VALUES
      (1, 12345678901234.123456, 9223372036854775807, 0.1, true, '2026-09-30 08:42:52.658',
       '2026-09-30 08:42:52+00', '2026-02-28', '{"a": [1, 2]}', '\\x89504e47', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
       'ñandú 🦆'),
      (2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  `);
  await client.end();
  await manager.connect(config, server.password);
});

afterAll(() => manager.disconnectAll());

describe('Ejecución en PostgreSQL', () => {
  it('conecta informando la base y el esquema por defecto', async () => {
    const info = await manager.connect(config, server.password);
    expect(info.defaultDatabase).toBe(server.database);
    // El usuario de pruebas se llama `dbx`: el "$user" del search_path resuelve a ese esquema.
    expect(info.defaultSchema).toBe('dbx');
  });

  it('ejecuta un SELECT y describe columnas con tabla de origen y PK', async () => {
    const req = request(['SELECT id, "Nombre" FROM dbx."CRendiciones_Conf_Generales" ORDER BY id'], {
      schema: 'dbx',
    });
    const summary = await manager.execute(req);
    expect(summary).toMatchObject({ executed: 1, failed: false, cancelled: false });
    const [cols] = eventsOf(req.queryId, 'columns');
    expect(cols?.columns[0]).toMatchObject({
      name: 'id',
      nativeType: 'integer',
      logicalType: 'integer',
      sourceTable: 'CRendiciones_Conf_Generales',
      sourceSchema: 'dbx',
      isPk: true,
    });
    expect(cols?.columns[1]).toMatchObject({ nativeType: 'character varying(120)', logicalType: 'text', isPk: false });
    expect(eventsOf(req.queryId, 'statement-done')[0]).toMatchObject({ command: 'SELECT', truncated: false });
  });

  it('devuelve decimales, enteros grandes, fechas y JSON como texto crudo sin pérdida', async () => {
    const req = request(['SELECT * FROM dbx.tipos ORDER BY id']);
    await manager.execute(req);
    const [row1, row2] = rowsOf(req.queryId);
    expect(row1).toEqual([
      1,
      '12345678901234.123456',
      '9223372036854775807',
      '0.1',
      true,
      '2026-09-30 08:42:52.658',
      expect.stringMatching(/^2026-09-30 \d\d:42:52[+-]\d\d/),
      '2026-02-28',
      '{"a": [1, 2]}',
      '\\x89504e47',
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      'ñandú 🦆',
    ]);
    expect(row2).toEqual([2, null, null, null, null, null, null, null, null, null, null, null]);
    const types = eventsOf(req.queryId, 'columns')[0]!.columns.map((c) => c.logicalType);
    expect(types).toEqual([
      'integer',
      'decimal',
      'integer',
      'float',
      'boolean',
      'datetime',
      'datetimetz',
      'date',
      'json',
      'binary',
      'uuid',
      'text',
    ]);
  });

  it('ejecuta varias sentencias con DML, NOTICE y resultados múltiples', async () => {
    const req = request([
      'CREATE TEMP TABLE tmp_x (a int)',
      'INSERT INTO tmp_x SELECT generate_series(1, 3)',
      "DO $$ BEGIN RAISE NOTICE 'hola %', 1; END $$",
      'SELECT count(*) AS n FROM tmp_x',
    ]);
    const summary = await manager.execute(req);
    expect(summary.executed).toBe(4);
    const done = eventsOf(req.queryId, 'statement-done');
    expect(done.map((d) => d.command)).toEqual(['CREATE', 'INSERT', 'DO', 'SELECT']);
    expect(done[1]).toMatchObject({ affected: 3, rowCount: 3 });
    expect(eventsOf(req.queryId, 'message')).toContainEqual(
      expect.objectContaining({ index: 2, severity: 'notice', text: 'hola 1' }),
    );
    expect(rowsOf(req.queryId, 3)).toEqual([['3']]);
  });

  it('la sesión conserva estado entre ejecuciones (tabla temporal)', async () => {
    const req = request(['SELECT count(*) FROM tmp_x']);
    await manager.execute(req);
    expect(rowsOf(req.queryId)).toEqual([['3']]);
  });

  it('informa errores con posición y detiene el script', async () => {
    const req = request(['SELECT 1', 'SELECT nocolumna FROM dbx.clientes', 'SELECT 3']);
    const summary = await manager.execute(req);
    expect(summary).toMatchObject({ executed: 2, failed: true });
    const [error] = eventsOf(req.queryId, 'statement-error');
    expect(error).toMatchObject({ index: 1, code: '42703', position: 8, cancelled: false });
    expect(error?.message).toContain('nocolumna');
  });

  it('respeta el límite, deja el cursor abierto y carga más en lotes', async () => {
    const req = request(['SELECT g FROM generate_series(1, 1234) g'], { maxRows: 500 });
    await manager.execute(req);
    expect(rowsOf(req.queryId)).toHaveLength(500);
    expect(eventsOf(req.queryId, 'statement-done')[0]).toMatchObject({ truncated: true, hasMore: true, rowCount: 500 });

    const more = await manager.fetchMore({ queryId: req.queryId, statementIndex: 0, count: 500 });
    expect(more).toEqual({ loaded: 500, hasMore: true });
    const rest = await manager.fetchMore({ queryId: req.queryId, statementIndex: 0, count: null });
    expect(rest).toEqual({ loaded: 234, hasMore: false });
    const all = rowsOf(req.queryId).map((r) => r[0]);
    expect(all).toHaveLength(1234);
    expect(all[1233]).toBe(1234);
    await expect(manager.fetchMore({ queryId: req.queryId, statementIndex: 0, count: 10 })).rejects.toThrow();
  });

  it('un resultado truncado que no es el último se cierra (sin "Cargar más")', async () => {
    const req = request(['SELECT generate_series(1, 20)', 'SELECT 1'], { maxRows: 10 });
    await manager.execute(req);
    expect(eventsOf(req.queryId, 'statement-done')[0]).toMatchObject({ truncated: true, hasMore: false });
    expect(rowsOf(req.queryId, 1)).toEqual([[1]]);
  });

  it('transmite 200 000 filas en lotes sin límite', async () => {
    const req = request(['SELECT g, md5(g::text) FROM generate_series(1, 200000) g'], { maxRows: null });
    await manager.execute(req);
    const batches = eventsOf(req.queryId, 'rows');
    expect(batches.every((b) => b.rows.length <= 500)).toBe(true);
    expect(batches.reduce((n, b) => n + b.rows.length, 0)).toBe(200_000);
  });

  it('cancela SELECT pg_sleep(30)', async () => {
    const req = request(['SELECT pg_sleep(30)', 'SELECT 2'], { sessionId: 'tab-cancel' });
    const started = Date.now();
    const running = manager.execute(req);
    await new Promise((r) => setTimeout(r, 400));
    await manager.queries.cancel(req.queryId);
    const summary = await running;
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(summary).toMatchObject({ cancelled: true, failed: true, executed: 1 });
    expect(eventsOf(req.queryId, 'statement-error')[0]).toMatchObject({ cancelled: true, code: '57014' });
    // La sesión sigue usable.
    const after = request(['SELECT 1'], { sessionId: 'tab-cancel' });
    await manager.execute(after);
    expect(rowsOf(after.queryId)).toEqual([[1]]);
  });

  it('rechaza una segunda ejecución en la misma sesión mientras corre', async () => {
    const slow = manager.execute(request(['SELECT pg_sleep(0.5)'], { sessionId: 'tab-busy' }));
    await new Promise((r) => setTimeout(r, 100));
    await expect(manager.execute(request(['SELECT 1'], { sessionId: 'tab-busy' }))).rejects.toThrow(
      /ejecutando/,
    );
    await slow;
  });

  it('usa el esquema elegido y cambia de base abriendo otra sesión', async () => {
    const req = request(['SELECT current_schema(), current_database()'], {
      sessionId: 'tab-schema',
      schema: 'dbx',
    });
    await manager.execute(req);
    expect(rowsOf(req.queryId)).toEqual([['dbx', server.database]]);

    const other = request(['SELECT current_database()'], { sessionId: 'tab-schema', database: 'postgres' });
    await manager.execute(other);
    expect(rowsOf(other.queryId)).toEqual([['postgres']]);
  });

  it('cuenta filas de una tabla', async () => {
    expect(await manager.countRows(config.id, { database: server.database, schema: 'dbx', name: 'tipos' })).toBe(2);
  });

  it('cerrar la sesión descarta su estado', async () => {
    await manager.queries.closeSession('tab-1');
    const req = request(['SELECT count(*) FROM tmp_x']);
    await manager.execute(req);
    expect(eventsOf(req.queryId, 'statement-error')[0]?.code).toBe('42P01');
  });
});
