import { readFile } from 'node:fs/promises';
import pg from 'pg';
import type { ClientConfig } from 'pg';
import type { ConnectionConfig, ServerInfo } from '@shared/connection';
import type { ColumnInfo, DbObject, DriverCapabilities, IndexInfo, ObjectKind } from '@shared/metadata';
import type { DbDriver, ObjectRef, Scope } from '../types';
import { DriverError } from '../types';

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

/** Convierte errores de `pg`/red en mensajes presentables sin datos sensibles. */
export function toDriverError(err: unknown): DriverError {
  if (err instanceof DriverError) return err;
  const e = err as { message?: string; code?: string };
  const message = e?.message ?? String(err);
  return new DriverError(message, e?.code);
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
    const { rows } = await client.query<{ server_version: string }>('SHOW server_version');
    const version = (rows[0]?.server_version ?? '').split(' ')[0] ?? '';
    return { product: `PostgreSQL ${version}`, version, latencyMs };
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
    const cfg = this.config;
    if (!cfg) throw new DriverError('La conexión no está abierta');
    const client = new pg.Client({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: this.secret,
      database,
      ssl: await sslOptions(cfg),
      connectionTimeoutMillis: cfg.connectTimeoutSec * 1000,
      application_name: 'DB Explorer',
      types: rawTypes(),
    });
    // Un error de socket en una conexión inactiva no debe tumbar el proceso.
    client.on('error', () => this.clients.delete(database));
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
