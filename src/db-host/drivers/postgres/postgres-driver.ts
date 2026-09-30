import { readFile } from 'node:fs/promises';
import pg from 'pg';
import type { ClientConfig, FieldDef } from 'pg';
import type { ConnectionConfig, ServerInfo } from '@shared/connection';
import type { ColumnInfo, DbObject, DriverCapabilities, IndexInfo, ObjectKind } from '@shared/metadata';
import type { LogicalType, ResultColumn } from '@shared/query';
import { qualifiedName } from '@shared/sql-quote';
import type { DbDriver, DbSession, ObjectRef, Scope } from '../types';
import { DriverError } from '../types';
import { toDriverError } from './errors';
import { PostgresSession } from './postgres-session';

/** Tipo lógico por OID de tipo (specs/03). */
const LOGICAL_BY_OID: Record<number, LogicalType> = {
  20: 'integer',
  21: 'integer',
  23: 'integer',
  26: 'integer',
  1700: 'decimal',
  790: 'decimal',
  700: 'float',
  701: 'float',
  16: 'boolean',
  25: 'text',
  1043: 'text',
  1042: 'text',
  19: 'text',
  18: 'text',
  1082: 'date',
  1083: 'time',
  1266: 'time',
  1114: 'datetime',
  1184: 'datetimetz',
  114: 'json',
  3802: 'json',
  17: 'binary',
  2950: 'uuid',
};

const RELKIND: Partial<Record<ObjectKind, string[]>> = {
  table: ['r', 'p'],
  view: ['v'],
  materializedView: ['m'],
  sequence: ['S'],
};

const PROKIND: Partial<Record<ObjectKind, string>> = { function: 'f', procedure: 'p' };

/** Tipos cuyo valor se devuelve como texto crudo (sin pérdida de precisión ni cambio de zona). */
const RAW_TEXT_TYPES = [
  20, // int8
  1700, // numeric
  1082, // date
  1083, // time
  1114, // timestamp
  1184, // timestamptz
  1266, // timetz
  1186, // interval
];

function rawTypes(): NonNullable<ClientConfig['types']> {
  return {
    getTypeParser: ((oid: number, format?: 'text' | 'binary') => {
      if (RAW_TEXT_TYPES.includes(oid)) return (value: string) => value;
      return pg.types.getTypeParser(oid, format ?? 'text');
    }) as NonNullable<ClientConfig['types']>['getTypeParser'],
  };
}

function formatRows(estimate: number): string | undefined {
  if (!(estimate >= 0)) return undefined;
  if (estimate < 1000) return String(Math.round(estimate));
  if (estimate < 1_000_000)
    return `${(estimate / 1000).toLocaleString('es', { maximumFractionDigits: 1 })} k`;
  return `${(estimate / 1_000_000).toLocaleString('es', { maximumFractionDigits: 1 })} M`;
}

export class PostgresDriver implements DbDriver {
  readonly engine = 'postgres' as const;
  readonly capabilities: DriverCapabilities = {
    databases: true,
    schemas: true,
    functions: true,
    procedures: true,
    sequences: true,
    triggers: false,
    materializedViews: true,
    cancel: true,
    multipleResultSets: false,
  };

  private config: ConnectionConfig | null = null;
  private secret: string | undefined;
  /** Postgres no permite `USE`: una conexión de metadatos por base. */
  private readonly clients = new Map<string, Promise<pg.Client>>();
  private defaultDatabase = 'postgres';

  async connect(config: ConnectionConfig, secret?: string): Promise<ServerInfo> {
    this.config = config;
    this.secret = secret;
    this.defaultDatabase = config.database?.trim() || 'postgres';
    const start = performance.now();
    const client = await this.client(this.defaultDatabase);
    const latencyMs = Math.round(performance.now() - start);
    const { rows } = await client.query<{ version: string; database: string; schema: string | null }>(
      `SELECT current_setting('server_version') AS version, current_database() AS database,
              current_schema() AS schema`,
    );
    const row = rows[0];
    const version = (row?.version ?? '').split(' ')[0] ?? '';
    this.defaultDatabase = row?.database ?? this.defaultDatabase;
    return {
      product: `PostgreSQL ${version}`,
      version,
      latencyMs,
      defaultDatabase: this.defaultDatabase,
      defaultSchema: row?.schema ?? 'public',
    };
  }

  async disconnect(): Promise<void> {
    const pending = [...this.clients.values()];
    this.clients.clear();
    await Promise.allSettled(
      pending.map(async (p) => {
        const c = await p;
        await c.end();
      }),
    );
  }

  async ping(): Promise<number> {
    const start = performance.now();
    await (await this.client(this.defaultDatabase)).query('SELECT 1');
    return Math.round(performance.now() - start);
  }

  async listDatabases(): Promise<DbObject[]> {
    const { rows } = await this.query<{ datname: string; size: string | null; template: boolean }>(
      this.defaultDatabase,
      `SELECT datname,
              CASE WHEN has_database_privilege(datname, 'CONNECT')
                   THEN pg_size_pretty(pg_database_size(datname)) END AS size,
              datistemplate AS template
         FROM pg_database
        WHERE datallowconn
        ORDER BY datname`,
    );
    return rows.map((r) => ({ name: r.datname, detail: r.size ?? undefined, system: r.template }));
  }

  async listSchemas(database: string): Promise<DbObject[]> {
    const { rows } = await this.query<{ nspname: string }>(
      database,
      `SELECT nspname FROM pg_namespace
        WHERE nspname NOT LIKE 'pg\\_toast%' AND nspname NOT LIKE 'pg\\_temp\\_%'
        ORDER BY nspname`,
    );
    return rows.map((r) => ({
      name: r.nspname,
      system: r.nspname.startsWith('pg_') || r.nspname === 'information_schema',
    }));
  }

  async countObjects(scope: Scope): Promise<Partial<Record<ObjectKind, number>>> {
    const { rows } = await this.query<{ kind: string; n: string }>(
      scope.database,
      `SELECT c.relkind::text AS kind, count(*)::text AS n
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r','p','v','m','S') AND NOT c.relispartition
        GROUP BY c.relkind
       UNION ALL
       SELECT 'proc_' || p.prokind::text, count(*)::text
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1 AND p.prokind IN ('f','p')
        GROUP BY p.prokind`,
      [scope.schema],
    );
    const counts: Partial<Record<ObjectKind, number>> = {};
    const add = (kind: ObjectKind, n: number): void => {
      counts[kind] = (counts[kind] ?? 0) + n;
    };
    for (const r of rows) {
      const n = Number(r.n);
      if (r.kind === 'r' || r.kind === 'p') add('table', n);
      else if (r.kind === 'v') add('view', n);
      else if (r.kind === 'm') add('materializedView', n);
      else if (r.kind === 'S') add('sequence', n);
      else if (r.kind === 'proc_f') add('function', n);
      else if (r.kind === 'proc_p') add('procedure', n);
    }
    return counts;
  }

  async listObjects(scope: Scope, kind: ObjectKind): Promise<DbObject[]> {
    const relkinds = RELKIND[kind];
    if (relkinds) {
      const { rows } = await this.query<{ relname: string; reltuples: number }>(
        scope.database,
        `SELECT c.relname, c.reltuples::float8 AS reltuples
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relkind = ANY($2) AND NOT c.relispartition
          ORDER BY c.relname`,
        [scope.schema, relkinds],
      );
      return rows.map((r) => ({
        name: r.relname,
        detail: kind === 'table' || kind === 'materializedView' ? formatRows(r.reltuples) : undefined,
      }));
    }
    const prokind = PROKIND[kind];
    if (prokind) {
      const { rows } = await this.query<{ proname: string; args: string; result: string | null }>(
        scope.database,
        `SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
                pg_get_function_result(p.oid) AS result
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = $1 AND p.prokind = $2
          ORDER BY p.proname, args`,
        [scope.schema, prokind],
      );
      return rows.map((r) => ({ name: `${r.proname}(${r.args})`, detail: r.result ?? undefined }));
    }
    return [];
  }

  async getColumns(ref: ObjectRef): Promise<ColumnInfo[]> {
    const { rows } = await this.query<{
      name: string;
      type: string;
      nullable: boolean;
      def: string | null;
      pk: boolean;
      comment: string | null;
    }>(
      ref.database,
      `SELECT a.attname AS name,
              format_type(a.atttypid, a.atttypmod) AS type,
              NOT a.attnotnull AS nullable,
              pg_get_expr(d.adbin, d.adrelid) AS def,
              COALESCE(a.attnum = ANY(i.indkey), false) AS pk,
              col_description(a.attrelid, a.attnum) AS comment
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
        WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`,
      [ref.schema, ref.name],
    );
    return rows.map((r) => ({
      name: r.name,
      nativeType: r.type,
      nullable: r.nullable,
      defaultValue: r.def ?? undefined,
      primaryKey: r.pk,
      comment: r.comment ?? undefined,
    }));
  }

  async getIndexes(ref: ObjectRef): Promise<IndexInfo[]> {
    const { rows } = await this.query<{ name: string; unique: boolean; primary: boolean; columns: string[] }>(
      ref.database,
      `SELECT ic.relname AS name, i.indisunique AS unique, i.indisprimary AS primary,
              ARRAY(SELECT pg_get_indexdef(i.indexrelid, k + 1, true)
                      FROM generate_subscripts(i.indkey, 1) AS k ORDER BY k) AS columns
         FROM pg_index i
         JOIN pg_class ic ON ic.oid = i.indexrelid
         JOIN pg_class t ON t.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = $1 AND t.relname = $2
        ORDER BY i.indisprimary DESC, ic.relname`,
      [ref.schema, ref.name],
    );
    return rows.map((r) => ({ name: r.name, unique: r.unique, primary: r.primary, columns: r.columns }));
  }

  async countRows(ref: ObjectRef): Promise<number> {
    const { rows } = await this.query<{ n: string }>(
      ref.database,
      `SELECT count(*)::text AS n FROM ${qualifiedName('postgres', { schema: ref.schema, name: ref.name })}`,
    );
    return Number(rows[0]?.n ?? 0);
  }

  async openSession(database: string | undefined, schema: string | undefined): Promise<DbSession> {
    const db = database || this.defaultDatabase;
    const client = await this.createClient(db, 'DB Explorer (editor)');
    const cfg = this.config!;
    try {
      if (cfg.queryTimeoutSec > 0) {
        await client.query("SELECT set_config('statement_timeout', $1, false)", [`${cfg.queryTimeoutSec}s`]);
      }
    } catch (err) {
      void client.end().catch(() => undefined);
      throw toDriverError(err);
    }
    // Un error de socket en la sesión no debe tumbar el proceso; la siguiente ejecución fallará con mensaje.
    client.on('error', () => undefined);
    const session = new PostgresSession(
      client,
      db,
      (fields) => this.describeFields(db, fields),
      async (pid) => {
        await this.query(this.defaultDatabase, 'SELECT pg_cancel_backend($1)', [pid]);
      },
    );
    await session.setSchema(schema);
    return session;
  }

  /** Nombres de tipo por `oid:typmod`, cacheados por base. */
  private readonly typeNames = new Map<string, string>();

  /** Tipo nativo, tabla de origen y PK de las columnas de un resultado. */
  private async describeFields(database: string, fields: FieldDef[]): Promise<ResultColumn[]> {
    const columns: ResultColumn[] = fields.map((f) => ({
      name: f.name,
      nativeType: '',
      logicalType: LOGICAL_BY_OID[f.dataTypeID] ?? 'other',
    }));
    try {
      const missing = fields.filter(
        (f) => !this.typeNames.has(`${database}:${f.dataTypeID}:${f.dataTypeModifier}`),
      );
      if (missing.length > 0) {
        const { rows } = await this.query<{ oid: number; mod: number; name: string }>(
          database,
          `SELECT u.o::int AS oid, u.m AS mod, format_type(u.o, u.m) AS name
             FROM unnest($1::oid[], $2::int4[]) AS u(o, m)`,
          [missing.map((f) => f.dataTypeID), missing.map((f) => f.dataTypeModifier)],
        );
        for (const r of rows) this.typeNames.set(`${database}:${r.oid}:${r.mod}`, r.name);
      }
      const sourced = fields.map((f, i) => ({ f, i })).filter(({ f }) => f.tableID > 0 && f.columnID > 0);
      const sources = new Map<number, { schema: string; table: string; column: string; pk: boolean }>();
      if (sourced.length > 0) {
        const { rows } = await this.query<{
          i: number;
          schema: string;
          table: string;
          column: string;
          pk: boolean;
        }>(
          database,
          `SELECT u.i::int AS i, n.nspname AS schema, c.relname AS table, a.attname AS column,
                  EXISTS (SELECT 1 FROM pg_index x
                           WHERE x.indrelid = c.oid AND x.indisprimary AND a.attnum = ANY (x.indkey)) AS pk
             FROM unnest($1::int4[], $2::oid[], $3::int2[]) AS u(i, t, col)
             JOIN pg_class c ON c.oid = u.t
             JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = u.col`,
          [sourced.map(({ i }) => i), sourced.map(({ f }) => f.tableID), sourced.map(({ f }) => f.columnID)],
        );
        for (const r of rows) sources.set(r.i, r);
      }
      fields.forEach((f, i) => {
        const col = columns[i]!;
        col.nativeType = this.typeNames.get(`${database}:${f.dataTypeID}:${f.dataTypeModifier}`) ?? '';
        const src = sources.get(i);
        if (src) {
          col.sourceSchema = src.schema;
          col.sourceTable = src.table;
          col.sourceColumn = src.column;
          col.isPk = src.pk;
        }
      });
    } catch {
      // Sin metadatos adicionales la grilla funciona igual (solo con el tipo lógico).
    }
    return columns;
  }

  private async query<R extends pg.QueryResultRow>(
    database: string,
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>> {
    const client = await this.client(database);
    try {
      return await client.query<R>(text, values);
    } catch (err) {
      throw toDriverError(err);
    }
  }

  private client(database: string): Promise<pg.Client> {
    const existing = this.clients.get(database);
    if (existing) return existing;
    const created = this.open(database);
    this.clients.set(database, created);
    created.catch(() => this.clients.delete(database));
    return created;
  }

  private async open(database: string): Promise<pg.Client> {
    const client = await this.createClient(database, 'DB Explorer');
    // Un error de socket en una conexión inactiva no debe tumbar el proceso.
    client.on('error', () => this.clients.delete(database));
    return client;
  }

  /** Abre una conexión física con la configuración actual (metadatos o sesión de editor). */
  private async createClient(database: string, applicationName: string): Promise<pg.Client> {
    const cfg = this.config;
    if (!cfg) throw new DriverError('La conexión no está abierta', 'not-connected');
    const client = new pg.Client({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: this.secret,
      database,
      ssl: await sslOptions(cfg),
      connectionTimeoutMillis: cfg.connectTimeoutSec * 1000,
      application_name: applicationName,
      types: rawTypes(),
    });
    try {
      await client.connect();
      if (cfg.readOnly) await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    } catch (err) {
      void client.end().catch(() => undefined);
      throw toDriverError(err);
    }
    return client;
  }
}

async function sslOptions(cfg: ConnectionConfig): Promise<ClientConfig['ssl']> {
  const mode = cfg.ssl?.mode ?? 'disable';
  if (mode === 'disable') return false;
  if (mode === 'require') return { rejectUnauthorized: false };
  const ca = cfg.ssl?.caFile ? await readFile(cfg.ssl.caFile, 'utf8') : undefined;
  if (mode === 'verify-ca') return { rejectUnauthorized: true, ca, checkServerIdentity: () => undefined };
  return { rejectUnauthorized: true, ca };
}
