import { Socket } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnectionConfig, Engine } from '@shared/connection';
import { newConnectionDefaults } from '@shared/connection';
import type { CellValue, LogicalType, QueryEvent } from '@shared/query';
import type { ConnectionManager } from '../../src/db-host/connection-manager';
import type { PgTestConfig } from './pg-server';
import { testEnv } from './test-env';

/**
 * Motores de la suite común de integración (specs/03 §Tests). Cada caso
 * declara su conexión, si se puede escribir en él y el SQL propio del
 * dialecto; las pruebas son las mismas para todos.
 */

export interface TableRef {
  database: string;
  schema: string;
  name: string;
  /** Columna de la clave primaria. */
  pk: string;
}

export interface EngineCase {
  engine: Engine;
  label: string;
  /** Motivo para saltar el motor (sin servidor); `null` si está disponible. */
  skip: string | null;
  /** false = servidor compartido de solo lectura: se saltan las pruebas que escriben. */
  writable: boolean;
  config: ConnectionConfig;
  password?: string;
  /** Prepara (o encuentra, si es de solo lectura) la tabla de pruebas. */
  prepare(run: Runner): Promise<TableRef>;
  sql: {
    /** `n` filas con una columna `n`. */
    rows(n: number): string;
    /** Consulta que tarda ~30 s o más (para cancelar; se ejecuta sin límite de filas). */
    sleep: string;
    /** Literales de varios tipos y lo que se espera recibir. */
    literals: string;
    expected: { values: CellValue[]; types: LogicalType[] };
    /** Sentencia que emite un mensaje (NOTICE, PRINT, aviso). */
    message?: { sql: string; text: RegExp };
    /** Una sentencia que devuelve dos resultados. */
    multipleResults?: string;
    begin: string;
    rollback: string;
  };
}

/** Ejecuta sentencias en una sesión propia y devuelve sus eventos (para preparar datos). */
export type Runner = (statements: string[], database?: string) => Promise<QueryEvent[]>;

export function runner(manager: ConnectionManager, events: QueryEvent[], connectionId: string): Runner {
  let n = 0;
  return async (statements, database) => {
    const queryId = `prep-${connectionId}-${n++}`;
    const summary = await manager.execute({
      queryId,
      sessionId: `prep-${connectionId}-${database ?? ''}`,
      connectionId,
      database,
      statements,
      maxRows: null,
    });
    const mine = events.filter((e) => e.queryId === queryId);
    const error = mine.find((e) => e.type === 'statement-error');
    if (summary.failed && error?.type === 'statement-error') throw new Error(error.message);
    return mine;
  };
}

/** ¿Responde el puerto TCP? (para saltar motores sin servidor sin esperar los tiempos de conexión). */
function reachable(host: string, port: number, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host, () => done(true));
  });
}

const FIXTURE_ROWS = [
  [1, 'Ana', '10.50'],
  [2, 'Beto', '0.00'],
  [3, 'Ñandú 🦆', null],
];

export async function engineCases(pg: PgTestConfig): Promise<EngineCase[]> {
  const env = testEnv();

  const postgres: EngineCase = {
    engine: 'postgres',
    label: 'PostgreSQL',
    skip: null,
    writable: true,
    config: {
      ...newConnectionDefaults('postgres', 'common-postgres'),
      name: 'PostgreSQL',
      host: pg.host,
      port: pg.port,
      user: pg.user,
      database: pg.database,
    },
    password: pg.password,
    async prepare(run) {
      await run([
        'DROP SCHEMA IF EXISTS comun CASCADE',
        'CREATE SCHEMA comun',
        'CREATE TABLE comun.clientes (id int PRIMARY KEY, nombre varchar(100) NOT NULL, importe numeric(12,2))',
        'CREATE INDEX idx_clientes_nombre ON comun.clientes (nombre)',
        `INSERT INTO comun.clientes VALUES ${FIXTURE_ROWS.map(([id, n, i]) => `(${id}, '${n}', ${i ?? 'NULL'})`).join(', ')}`,
      ]);
      return { database: pg.database, schema: 'comun', name: 'clientes', pk: 'id' };
    },
    sql: {
      rows: (n) => `SELECT generate_series(1, ${n}) AS n`,
      sleep: 'SELECT pg_sleep(30)',
      literals: `SELECT 12345678901234.123456::numeric(20,6) AS dec, DATE '2026-02-28' AS dia,
        TIMESTAMP '2026-09-30 08:42:52.658' AS ts, '{"a": 1}'::jsonb AS js, '\\x89504e47'::bytea AS bin,
        NULL::text AS nada, 'ñandú 🦆' AS uni`,
      expected: {
        values: ['12345678901234.123456', '2026-02-28', '2026-09-30 08:42:52.658', '{"a": 1}', '\\x89504e47', null, 'ñandú 🦆'],
        types: ['decimal', 'date', 'datetime', 'json', 'binary', 'text', 'text'],
      },
      message: { sql: "DO $$ BEGIN RAISE NOTICE 'hola desde el servidor'; END $$", text: /hola desde el servidor/ },
      begin: 'BEGIN',
      rollback: 'ROLLBACK',
    },
  };

  const sqliteFile = join(mkdtempSync(join(tmpdir(), 'dbx-sqlite-')), 'pruebas.db');
  const sqlite: EngineCase = {
    engine: 'sqlite',
    label: 'SQLite',
    skip: null,
    writable: true,
    config: {
      ...newConnectionDefaults('sqlite', 'common-sqlite'),
      name: 'SQLite',
      file: sqliteFile,
      sqliteCreate: true,
    },
    async prepare(run) {
      await run([
        'DROP TABLE IF EXISTS clientes',
        'CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre VARCHAR(100) NOT NULL, importe DECIMAL(12,2))',
        'CREATE INDEX idx_clientes_nombre ON clientes (nombre)',
        `INSERT INTO clientes VALUES ${FIXTURE_ROWS.map(([id, n, i]) => `(${id}, '${n}', ${i ?? 'NULL'})`).join(', ')}`,
      ]);
      return { database: 'main', schema: 'main', name: 'clientes', pk: 'id' };
    },
    sql: {
      rows: (n) =>
        `WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < ${n}) SELECT n FROM s`,
      // Sin función de espera: una recursión infinita que entrega filas hasta que se cancela.
      sleep: 'WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s) SELECT n FROM s WHERE n % 1000 = 0',
      literals: `SELECT 9007199254740993 AS grande, 0.5 AS medio, X'89504E47' AS bin, NULL AS nada,
        'ñandú 🦆' AS uni, json_object('a', 1) AS js`,
      expected: {
        values: ['9007199254740993', 0.5, '0x89504E47', null, 'ñandú 🦆', '{"a":1}'],
        types: ['integer', 'float', 'binary', 'other', 'text', 'text'],
      },
      begin: 'BEGIN',
      rollback: 'ROLLBACK',
    },
  };

  const msHost = env('MSSQL_HOST', '127.0.0.1')!;
  const msPort = Number(env('MSSQL_PORT', '51433'));
  const msDatabase = env('MSSQL_DATABASE', 'dbx_test')!;
  const sqlserver: EngineCase = {
    engine: 'sqlserver',
    label: 'SQL Server',
    skip: (await reachable(msHost, msPort)) ? null : `sin servidor en ${msHost}:${msPort}`,
    writable: true,
    config: {
      ...newConnectionDefaults('sqlserver', 'common-sqlserver'),
      name: 'SQL Server',
      host: msHost,
      port: msPort,
      user: env('MSSQL_USER', 'sa'),
      ssl: { mode: 'require', encrypt: true, trustServerCertificate: true },
    },
    password: env('MSSQL_PASSWORD') ?? env('MSSQL_SA_PASSWORD'),
    async prepare(run) {
      // Solo se escribe en una base propia de las pruebas (nunca en las existentes).
      await run([`IF DB_ID(N'${msDatabase}') IS NULL CREATE DATABASE [${msDatabase}]`], 'master');
      await run(
        [
          "IF SCHEMA_ID(N'comun') IS NULL EXEC (N'CREATE SCHEMA comun')",
          'DROP TABLE IF EXISTS comun.clientes',
          'CREATE TABLE comun.clientes (id int CONSTRAINT pk_clientes PRIMARY KEY, nombre nvarchar(100) NOT NULL, importe decimal(12,2))',
          'CREATE INDEX idx_clientes_nombre ON comun.clientes (nombre)',
          `INSERT INTO comun.clientes VALUES ${FIXTURE_ROWS.map(([id, n, i]) => `(${id}, N'${n}', ${i ?? 'NULL'})`).join(', ')}`,
        ],
        msDatabase,
      );
      return { database: msDatabase, schema: 'comun', name: 'clientes', pk: 'id' };
    },
    sql: {
      rows: (n) =>
        `WITH s AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM s WHERE n < ${n}) SELECT n FROM s OPTION (MAXRECURSION 0)`,
      sleep: "WAITFOR DELAY '00:00:30'",
      literals: `SELECT CAST(12345678901234.123456 AS decimal(20,6)) AS dec_, CAST('2026-02-28' AS date) AS dia,
        CAST('2026-09-30 08:42:52.6581234' AS datetime2(7)) AS ts, CAST('2026-09-30 08:42:52.658' AS datetime) AS dt,
        CAST('2026-09-30 08:42:52 -05:00' AS datetimeoffset(0)) AS dto, CAST(-922337203685477.5808 AS money) AS dinero,
        0x89504E47 AS bin, CAST(NULL AS nvarchar(10)) AS nada, N'ñandú 🦆' AS uni, CAST(1 AS bit) AS si,
        CAST('A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11' AS uniqueidentifier) AS u, CAST(9223372036854775807 AS bigint) AS grande`,
      expected: {
        values: [
          '12345678901234.123456',
          '2026-02-28',
          '2026-09-30 08:42:52.6581234',
          '2026-09-30 08:42:52.657',
          '2026-09-30 08:42:52 -05:00',
          '-922337203685477.5808',
          '0x89504E47',
          null,
          'ñandú 🦆',
          true,
          'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11',
          '9223372036854775807',
        ],
        types: ['decimal', 'date', 'datetime', 'datetime', 'datetimetz', 'decimal', 'binary', 'text', 'text', 'boolean', 'uuid', 'integer'],
      },
      message: { sql: "PRINT 'hola desde el servidor'", text: /hola desde el servidor/ },
      multipleResults: 'IF 1 = 1 BEGIN SELECT 1 AS a; SELECT 2 AS b, 3 AS c; END',
      begin: 'BEGIN TRAN',
      rollback: 'ROLLBACK',
    },
  };

  const myHost = env('MARIADB_HOST', '127.0.0.1')!;
  const myPort = Number(env('MARIADB_PORT', '53306'));
  const mariadb: EngineCase = {
    engine: 'mariadb',
    label: 'MariaDB',
    skip: (await reachable(myHost, myPort)) ? null : `sin servidor en ${myHost}:${myPort}`,
    // Un servidor compartido de solo lectura no admite las pruebas que escriben.
    writable: env('MARIADB_READONLY', '0') !== '1',
    config: {
      ...newConnectionDefaults('mariadb', 'common-mariadb'),
      name: 'MariaDB',
      host: myHost,
      port: myPort,
      user: env('MARIADB_USER', 'dbx'),
      database: env('MARIADB_DATABASE'),
    },
    password: env('MARIADB_PASSWORD'),
    async prepare(run) {
      if (env('MARIADB_READONLY', '0') === '1') {
        // Solo lectura: se usa la primera tabla con clave primaria simple que haya.
        const events = await run([
          `SELECT k.table_schema, k.table_name, k.column_name
             FROM information_schema.key_column_usage k
             JOIN information_schema.tables t ON t.table_schema = k.table_schema AND t.table_name = k.table_name
            WHERE k.constraint_name = 'PRIMARY' AND t.table_type = 'BASE TABLE'
              AND k.table_schema NOT IN ('mysql', 'sys', 'performance_schema', 'information_schema')
              AND NOT EXISTS (SELECT 1 FROM information_schema.key_column_usage k2
                               WHERE k2.table_schema = k.table_schema AND k2.table_name = k.table_name
                                 AND k2.constraint_name = 'PRIMARY' AND k2.ordinal_position > 1)
            ORDER BY k.table_schema, k.table_name LIMIT 1`,
        ]);
        const row = events.flatMap((e) => (e.type === 'rows' ? e.rows : []))[0];
        if (!row) throw new Error('No hay tablas con clave primaria para las pruebas de solo lectura');
        return { database: String(row[0]), schema: String(row[0]), name: String(row[1]), pk: String(row[2]) };
      }
      const db = env('MARIADB_DATABASE', 'dbx_test')!;
      await run([
        `DROP TABLE IF EXISTS \`${db}\`.clientes`,
        `CREATE TABLE \`${db}\`.clientes (id int PRIMARY KEY, nombre varchar(100) NOT NULL, importe decimal(12,2), INDEX idx_clientes_nombre (nombre))`,
        `INSERT INTO \`${db}\`.clientes VALUES ${FIXTURE_ROWS.map(([id, n, i]) => `(${id}, '${n}', ${i ?? 'NULL'})`).join(', ')}`,
      ]);
      return { database: db, schema: db, name: 'clientes', pk: 'id' };
    },
    sql: {
      rows: (n) =>
        `WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < ${n}) SELECT n FROM s`,
      sleep: 'SELECT SLEEP(30)',
      literals: `SELECT CAST(12345678901234.123456 AS DECIMAL(20,6)) AS dec_, DATE '2026-02-28' AS dia,
        CAST('2026-09-30 08:42:52.658' AS DATETIME(3)) AS ts, X'89504E47' AS bin, NULL AS nada,
        'ñandú 🦆' AS uni, CAST(9223372036854775807 AS UNSIGNED) AS grande`,
      expected: {
        values: ['12345678901234.123456', '2026-02-28', '2026-09-30 08:42:52.658', '0x89504E47', null, 'ñandú 🦆', '9223372036854775807'],
        types: ['decimal', 'date', 'datetime', 'binary', 'other', 'text', 'integer'],
      },
      // mysql2 solo informa la cantidad de avisos en respuestas OK (no en SELECT): se usa DO.
      message: { sql: 'DO 1 / 0', text: /Division by 0/i },
      begin: 'BEGIN',
      rollback: 'ROLLBACK',
    },
  };

  return [postgres, sqlite, sqlserver, mariadb];
}
