import { readFile } from 'node:fs/promises';
import mysql from 'mysql2';
import type { Connection, ConnectionOptions, RowDataPacket } from 'mysql2';
import type { ConnectionConfig, ServerInfo } from '@shared/connection';
import type { ColumnInfo, DbObject, DriverCapabilities, IndexInfo, ObjectKind } from '@shared/metadata';
import { qualifiedName } from '@shared/sql-quote';
import type { DbDriver, DbSession, ObjectRef, Scope } from '../types';
import { DriverError } from '../types';
import { formatRowEstimate } from '../common';
import { toMariaDbError } from './errors';
import { MariaDbSession } from './mariadb-session';

const SYSTEM_DATABASES = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);

const TABLE_TYPES: Partial<Record<ObjectKind, string[]>> = {
  table: ['BASE TABLE', 'SYSTEM VERSIONED'],
  view: ['VIEW'],
  sequence: ['SEQUENCE'],
};

const ROUTINE_TYPES: Partial<Record<ObjectKind, string>> = { function: 'FUNCTION', procedure: 'PROCEDURE' };

type Row = Record<string, unknown>;

/**
 * Driver de MariaDB/MySQL sobre `mysql2`. Base y esquema son lo mismo: el
 * árbol muestra Conexión → Bases → carpetas (sin nivel esquema). Metadatos
 * por `information_schema` en una conexión compartida (`mysql2` encola las
 * consultas); ejecución en sesiones dedicadas por pestaña.
 */
export class MariaDbDriver implements DbDriver {
  readonly engine = 'mariadb' as const;
  readonly capabilities: DriverCapabilities = {
    databases: true,
    schemas: false,
    functions: true,
    procedures: true,
    // Las secuencias existen en MariaDB 10.3+, no en MySQL (se ajusta al conectar).
    sequences: true,
    triggers: false,
    materializedViews: false,
    cancel: true,
    multipleResultSets: true,
  };

  private config: ConnectionConfig | null = null;
  private secret: string | undefined;
  private metadata: Promise<Connection> | null = null;
  private isMariaDb = true;

  async connect(config: ConnectionConfig, secret?: string): Promise<ServerInfo> {
    this.config = config;
    this.secret = secret;
    const start = performance.now();
    await this.metadataConnection();
    const latencyMs = Math.round(performance.now() - start);
    const [row] = await this.query('SELECT VERSION() AS version, DATABASE() AS db');
    const full = String(row?.['version'] ?? '');
    this.isMariaDb = /mariadb/i.test(full);
    this.capabilities.sequences = this.isMariaDb;
    const version = full.split('-')[0] ?? full;
    return {
      product: `${this.isMariaDb ? 'MariaDB' : 'MySQL'} ${version}`,
      version,
      latencyMs,
      defaultDatabase: row?.['db'] ? String(row['db']) : undefined,
    };
  }

  async disconnect(): Promise<void> {
    const pending = this.metadata;
    this.metadata = null;
    const conn = await pending?.catch(() => null);
    if (conn) await new Promise<void>((resolve) => conn.end(() => resolve()));
  }

  async ping(): Promise<number> {
    const start = performance.now();
    await this.query('SELECT 1');
    return Math.round(performance.now() - start);
  }

  async listDatabases(): Promise<DbObject[]> {
    const rows = await this.query('SELECT schema_name AS name FROM information_schema.schemata ORDER BY schema_name');
    return rows.map((r) => {
      const name = String(r['name']);
      return { name, system: SYSTEM_DATABASES.has(name.toLowerCase()) };
    });
  }

  async listSchemas(): Promise<DbObject[]> {
    return [];
  }

  async countObjects(scope: Scope): Promise<Partial<Record<ObjectKind, number>>> {
    const rows = await this.query(
      `SELECT table_type AS kind, COUNT(*) AS n FROM information_schema.tables
        WHERE table_schema = ? GROUP BY table_type
       UNION ALL
       SELECT routine_type, COUNT(*) FROM information_schema.routines
        WHERE routine_schema = ? GROUP BY routine_type`,
      [scope.database, scope.database],
    );
    const counts: Partial<Record<ObjectKind, number>> = {};
    for (const r of rows) {
      const kind = String(r['kind']);
      const objectKind =
        (Object.keys(TABLE_TYPES) as ObjectKind[]).find((k) => TABLE_TYPES[k]!.includes(kind)) ??
        (Object.keys(ROUTINE_TYPES) as ObjectKind[]).find((k) => ROUTINE_TYPES[k] === kind);
      if (objectKind) counts[objectKind] = (counts[objectKind] ?? 0) + Number(r['n']);
    }
    return counts;
  }

  async listObjects(scope: Scope, kind: ObjectKind): Promise<DbObject[]> {
    const tableTypes = TABLE_TYPES[kind];
    if (tableTypes) {
      const rows = await this.query(
        `SELECT table_name AS name, table_rows AS estimate FROM information_schema.tables
          WHERE table_schema = ? AND table_type IN (?) ORDER BY table_name`,
        [scope.database, tableTypes],
      );
      return rows.map((r) => ({
        name: String(r['name']),
        detail: kind === 'table' && r['estimate'] !== null ? formatRowEstimate(Number(r['estimate'])) : undefined,
      }));
    }
    const routineType = ROUTINE_TYPES[kind];
    if (routineType) {
      const rows = await this.query(
        `SELECT routine_name AS name, dtd_identifier AS result FROM information_schema.routines
          WHERE routine_schema = ? AND routine_type = ? ORDER BY routine_name`,
        [scope.database, routineType],
      );
      return rows.map((r) => ({ name: String(r['name']), detail: r['result'] ? String(r['result']) : undefined }));
    }
    return [];
  }

  async getColumns(ref: ObjectRef): Promise<ColumnInfo[]> {
    const rows = await this.query(
      `SELECT column_name AS name, column_type AS type, is_nullable AS nullable, column_default AS def,
              column_key AS col_key, column_comment AS comment
         FROM information_schema.columns
        WHERE table_schema = ? AND table_name = ?
        ORDER BY ordinal_position`,
      [ref.database, ref.name],
    );
    return rows.map((r) => ({
      name: String(r['name']),
      nativeType: String(r['type']),
      nullable: r['nullable'] === 'YES',
      defaultValue: r['def'] === null || r['def'] === undefined ? undefined : String(r['def']),
      primaryKey: r['col_key'] === 'PRI',
      comment: r['comment'] ? String(r['comment']) : undefined,
    }));
  }

  async getIndexes(ref: ObjectRef): Promise<IndexInfo[]> {
    const rows = await this.query(
      `SELECT index_name AS name, non_unique AS non_unique, column_name AS col
         FROM information_schema.statistics
        WHERE table_schema = ? AND table_name = ?
        ORDER BY index_name = 'PRIMARY' DESC, index_name, seq_in_index`,
      [ref.database, ref.name],
    );
    const byName = new Map<string, IndexInfo>();
    for (const r of rows) {
      const name = String(r['name']);
      let index = byName.get(name);
      if (!index) {
        index = { name, unique: Number(r['non_unique']) === 0, primary: name === 'PRIMARY', columns: [] };
        byName.set(name, index);
      }
      index.columns.push(r['col'] === null ? '(expresión)' : String(r['col']));
    }
    return [...byName.values()];
  }

  async countRows(ref: ObjectRef): Promise<number> {
    const [row] = await this.query(
      `SELECT COUNT(*) AS n FROM ${qualifiedName('mariadb', { schema: ref.database, name: ref.name })}`,
    );
    return Number(row?.['n'] ?? 0);
  }

  async openSession(database: string | undefined): Promise<DbSession> {
    const cfg = this.requireConfig();
    const connection = await this.open(database || undefined);
    try {
      if (cfg.queryTimeoutSec > 0) {
        await this.run(
          connection,
          this.isMariaDb
            ? `SET SESSION max_statement_time = ${cfg.queryTimeoutSec}`
            : `SET SESSION max_execution_time = ${cfg.queryTimeoutSec * 1000}`,
        );
      }
    } catch (err) {
      connection.destroy();
      throw err;
    }
    return new MariaDbSession(connection, database ?? '', async (threadId) => {
      await this.query(`KILL QUERY ${Number(threadId)}`);
    });
  }

  private async query(sql: string, values: unknown[] = []): Promise<Row[]> {
    const conn = await this.metadataConnection();
    return new Promise<Row[]>((resolve, reject) => {
      conn.query<RowDataPacket[]>({ sql, values }, (err, rows) =>
        err ? reject(toMariaDbError(err)) : resolve(rows as Row[]),
      );
    });
  }

  private run(conn: Connection, sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      conn.query(sql, (err) => (err ? reject(toMariaDbError(err)) : resolve()));
    });
  }

  private metadataConnection(): Promise<Connection> {
    if (this.metadata) return this.metadata;
    const cfg = this.requireConfig();
    const created = this.open(cfg.database?.trim() || undefined);
    this.metadata = created;
    created
      .then((conn) => {
        // Si se corta (red, reinicio, tiempo de inactividad del servidor), la siguiente consulta reconecta.
        const forget = (): void => {
          if (this.metadata === created) this.metadata = null;
        };
        conn.on('error', forget);
        conn.on('end', forget);
      })
      .catch(() => {
        if (this.metadata === created) this.metadata = null;
      });
    return created;
  }

  /** Abre una conexión física con la configuración actual. */
  private async open(database: string | undefined): Promise<Connection> {
    const cfg = this.requireConfig();
    const options: ConnectionOptions = {
      host: cfg.host?.trim() || 'localhost',
      port: cfg.port ?? 3306,
      user: cfg.user,
      password: this.secret,
      database,
      ssl: await sslOptions(cfg),
      connectTimeout: cfg.connectTimeoutSec * 1000,
      charset: 'UTF8MB4_UNICODE_CI',
      // Valores crudos: fechas, DECIMAL y BIGINT como texto (sin pérdida ni cambio de zona).
      dateStrings: true,
      decimalNumbers: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
      multipleStatements: false,
    };
    const conn = mysql.createConnection(options);
    try {
      await new Promise<void>((resolve, reject) => conn.connect((err) => (err ? reject(err) : resolve())));
      if (cfg.readOnly) await this.run(conn, 'SET SESSION TRANSACTION READ ONLY');
    } catch (err) {
      conn.destroy();
      throw toMariaDbError(err);
    }
    return conn;
  }

  private requireConfig(): ConnectionConfig {
    if (!this.config) throw new DriverError('La conexión no está abierta', 'not-connected');
    return this.config;
  }
}

async function sslOptions(cfg: ConnectionConfig): Promise<ConnectionOptions['ssl']> {
  const mode = cfg.ssl?.mode ?? 'disable';
  if (mode === 'disable') return undefined;
  if (mode === 'require') return { rejectUnauthorized: false };
  const ca = cfg.ssl?.caFile ? await readFile(cfg.ssl.caFile, 'utf8') : undefined;
  return { ca, rejectUnauthorized: true, verifyIdentity: mode === 'verify-full' };
}
