import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { ConnectionConfig, ServerInfo } from '@shared/connection';
import type { ColumnInfo, DbObject, DriverCapabilities, IndexInfo, ObjectKind } from '@shared/metadata';
import { quoteIdent } from '@shared/sql-quote';
import type { DbDriver, DbSession, ObjectRef, Scope } from '../types';
import { DriverError } from '../types';
import { SqliteSession } from './sqlite-session';

/** Espera máxima ante un archivo bloqueado por otra conexión (la de metadatos corre en el hilo del db-host). */
const METADATA_BUSY_TIMEOUT_MS = 2000;
const SESSION_BUSY_TIMEOUT_MS = 5000;

const TYPE_BY_KIND: Partial<Record<ObjectKind, string>> = { table: 'table', view: 'view', trigger: 'trigger' };

function toDriverError(err: unknown): DriverError {
  if (err instanceof DriverError) return err;
  const e = err as { message?: string; code?: string };
  return new DriverError(e?.message ?? String(err), e?.code);
}

/**
 * Driver de SQLite con `node:sqlite` (incluido en Electron; sin módulos
 * nativos que recompilar). "Conexión" = archivo; sin bases ni esquemas: el
 * árbol muestra directamente las carpetas de `main`.
 */
export class SqliteDriver implements DbDriver {
  readonly engine = 'sqlite' as const;
  readonly capabilities: DriverCapabilities = {
    databases: false,
    schemas: false,
    functions: false,
    procedures: false,
    sequences: false,
    triggers: false,
    materializedViews: false,
    cancel: true,
    multipleResultSets: false,
  };

  private config: ConnectionConfig | null = null;
  private db: DatabaseSync | null = null;

  async connect(config: ConnectionConfig): Promise<ServerInfo> {
    const file = config.file?.trim();
    if (!file) throw new DriverError('Falta la ruta del archivo de SQLite');
    const readOnly = !!config.sqliteReadOnly || config.readOnly;
    if (!existsSync(file) && (readOnly || !config.sqliteCreate)) {
      throw new DriverError(`El archivo no existe: ${file}`, 'not-found');
    }
    const start = performance.now();
    try {
      this.db = new DatabaseSync(file, { readOnly, timeout: METADATA_BUSY_TIMEOUT_MS });
      const version = this.get<{ v: string }>('SELECT sqlite_version() AS v')?.v ?? '';
      this.config = config;
      return {
        product: `SQLite ${version}`,
        version,
        latencyMs: Math.round(performance.now() - start),
        defaultDatabase: 'main',
      };
    } catch (err) {
      this.db?.close();
      this.db = null;
      throw toDriverError(err);
    }
  }

  async disconnect(): Promise<void> {
    const db = this.db;
    this.db = null;
    if (db?.isOpen) db.close();
  }

  async ping(): Promise<number> {
    const start = performance.now();
    this.get('SELECT 1');
    return Math.round(performance.now() - start);
  }

  async listDatabases(): Promise<DbObject[]> {
    return [{ name: 'main' }];
  }

  async listSchemas(): Promise<DbObject[]> {
    return [];
  }

  async countObjects(): Promise<Partial<Record<ObjectKind, number>>> {
    const rows = this.all<{ type: string; n: number }>(
      `SELECT type, count(*) AS n FROM sqlite_schema
        WHERE type IN ('table', 'view', 'trigger') AND (? OR name NOT LIKE 'sqlite\\_%' ESCAPE '\\')
        GROUP BY type`,
      this.showSystem(),
    );
    const counts: Partial<Record<ObjectKind, number>> = {};
    for (const r of rows) {
      const kind = (Object.keys(TYPE_BY_KIND) as ObjectKind[]).find((k) => TYPE_BY_KIND[k] === r.type);
      if (kind) counts[kind] = Number(r.n);
    }
    return counts;
  }

  async listObjects(_scope: Scope, kind: ObjectKind): Promise<DbObject[]> {
    const type = TYPE_BY_KIND[kind];
    if (!type) return [];
    const rows = this.all<{ name: string }>(
      `SELECT name FROM sqlite_schema
        WHERE type = ? AND (? OR name NOT LIKE 'sqlite\\_%' ESCAPE '\\')
        ORDER BY name COLLATE NOCASE`,
      type,
      this.showSystem(),
    );
    return rows.map((r) => ({ name: r.name, system: r.name.startsWith('sqlite_') }));
  }

  async getColumns(ref: ObjectRef): Promise<ColumnInfo[]> {
    const rows = this.all<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>(
      'SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?) ORDER BY cid',
      ref.name,
    );
    return rows.map((r) => ({
      name: r.name,
      nativeType: r.type || '',
      // Una columna `INTEGER PRIMARY KEY` es el rowid: nunca es nula aunque no declare NOT NULL.
      nullable: Number(r.notnull) === 0 && Number(r.pk) === 0,
      defaultValue: r.dflt_value ?? undefined,
      primaryKey: Number(r.pk) > 0,
    }));
  }

  async getIndexes(ref: ObjectRef): Promise<IndexInfo[]> {
    const indexes = this.all<{ name: string; unique: number; origin: string }>(
      'SELECT name, "unique", origin FROM pragma_index_list(?)',
      ref.name,
    );
    const result = indexes.map((i) => ({
      name: i.name,
      unique: Number(i.unique) === 1,
      primary: i.origin === 'pk',
      columns: this.all<{ name: string | null }>(
        'SELECT name FROM pragma_index_info(?) ORDER BY seqno',
        i.name,
      ).map((c) => c.name ?? '(expresión)'),
    }));
    // `INTEGER PRIMARY KEY` es el rowid y no tiene índice propio: se muestra igual como clave primaria.
    if (!result.some((i) => i.primary)) {
      const pk = (await this.getColumns(ref)).filter((c) => c.primaryKey).map((c) => c.name);
      if (pk.length > 0) result.push({ name: 'PRIMARY KEY', unique: true, primary: true, columns: pk });
    }
    return result.sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
  }

  async countRows(ref: ObjectRef): Promise<number> {
    return Number(this.get<{ n: number }>(`SELECT count(*) AS n FROM ${quoteIdent('sqlite', ref.name)}`)?.n ?? 0);
  }

  async openSession(): Promise<DbSession> {
    const cfg = this.requireConfig();
    const session = new SqliteSession(
      {
        file: cfg.file!.trim(),
        readOnly: !!cfg.sqliteReadOnly || cfg.readOnly,
        busyTimeoutMs: SESSION_BUSY_TIMEOUT_MS,
      },
      cfg.queryTimeoutSec,
    );
    await session.start();
    return session;
  }

  private showSystem(): number {
    return this.config?.showSystemObjects ? 1 : 0;
  }

  private requireConfig(): ConnectionConfig {
    if (!this.config || !this.db) throw new DriverError('La conexión no está abierta', 'not-connected');
    return this.config;
  }

  private all<R>(sql: string, ...params: (string | number)[]): R[] {
    this.requireConfig();
    try {
      return this.db!.prepare(sql).all(...params) as R[];
    } catch (err) {
      throw toDriverError(err);
    }
  }

  private get<R>(sql: string, ...params: (string | number)[]): R | undefined {
    if (!this.db) throw new DriverError('La conexión no está abierta', 'not-connected');
    try {
      return this.db.prepare(sql).get(...params) as R | undefined;
    } catch (err) {
      throw toDriverError(err);
    }
  }
}
