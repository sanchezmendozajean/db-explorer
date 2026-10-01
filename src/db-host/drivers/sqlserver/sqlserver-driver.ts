import type { ConnectionConfiguration } from 'tedious';
import { Connection, Request, TYPES } from 'tedious';
import type { ConnectionConfig, ServerInfo } from '@shared/connection';
import type { ColumnInfo, DbObject, DriverCapabilities, IndexInfo, ObjectKind } from '@shared/metadata';
import { qualifiedName } from '@shared/sql-quote';
import type { DbDriver, DbSession, ObjectRef, Scope } from '../types';
import { DriverError } from '../types';
import { formatRowEstimate } from '../common';
import { toSqlServerError } from './errors';
import { installExactValues } from './exact-values';
import type { DescribedColumn } from './sqlserver-session';
import { SqlServerSession } from './sqlserver-session';

/** Tiempo máximo de las consultas de metadatos (el árbol no debe quedar colgado). */
const METADATA_TIMEOUT_MS = 60_000;

/** Tipos de `sys.objects` por tipo de objeto del árbol. */
const OBJECT_TYPES: Partial<Record<ObjectKind, string[]>> = {
  table: ['U'],
  view: ['V'],
  function: ['FN', 'IF', 'TF', 'FS', 'FT'],
  procedure: ['P', 'PC'],
  sequence: ['SO'],
};

const SYSTEM_SCHEMAS = new Set(['sys', 'INFORMATION_SCHEMA', 'guest']);

const PRODUCT_YEARS: Record<number, string> = {
  11: '2012',
  12: '2014',
  13: '2016',
  14: '2017',
  15: '2019',
  16: '2022',
  17: '2025',
};

/** `[nombre]` con los `]` duplicados, para usar un nombre de base en consultas de catálogo. */
function bracket(name: string): string {
  return `[${name.replace(/]/g, ']]')}]`;
}

type Row = Record<string, unknown>;
type Param = string | number;

/**
 * Driver de SQL Server sobre `tedious`. Metadatos por una conexión compartida
 * (con cola: `tedious` atiende una petición a la vez) usando nombres de tres
 * partes (`[base].sys.tables`); ejecución en sesiones dedicadas por pestaña.
 */
export class SqlServerDriver implements DbDriver {
  readonly engine = 'sqlserver' as const;
  readonly capabilities: DriverCapabilities = {
    databases: true,
    schemas: true,
    functions: true,
    procedures: true,
    sequences: true,
    triggers: false,
    materializedViews: false,
    cancel: true,
    multipleResultSets: true,
    batchSeparator: 'GO',
  };

  private config: ConnectionConfig | null = null;
  private secret: string | undefined;
  private metadata: Promise<Connection> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private defaultDatabase = 'master';

  constructor() {
    installExactValues();
  }

  async connect(config: ConnectionConfig, secret?: string): Promise<ServerInfo> {
    this.config = config;
    this.secret = secret;
    const start = performance.now();
    await this.metadataConnection();
    const latencyMs = Math.round(performance.now() - start);
    const [row] = await this.query(
      `SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS version,
              CAST(SERVERPROPERTY('EngineEdition') AS int) AS edition,
              DB_NAME() AS db, SCHEMA_NAME() AS sch`,
    );
    const version = String(row?.['version'] ?? '');
    const edition = Number(row?.['edition']);
    const year = PRODUCT_YEARS[Number(version.split('.')[0])];
    this.defaultDatabase = String(row?.['db'] ?? 'master');
    return {
      product:
        edition === 5 || edition === 8 ? 'Azure SQL' : year ? `SQL Server ${year}` : `SQL Server ${version}`,
      version,
      latencyMs,
      defaultDatabase: this.defaultDatabase,
      defaultSchema: String(row?.['sch'] ?? 'dbo'),
    };
  }

  async disconnect(): Promise<void> {
    const pending = this.metadata;
    this.metadata = null;
    if (!pending) return;
    const conn = await pending.catch(() => null);
    conn?.close();
  }

  async ping(): Promise<number> {
    const start = performance.now();
    await this.query('SELECT 1 AS x');
    return Math.round(performance.now() - start);
  }

  async listDatabases(): Promise<DbObject[]> {
    const rows = await this.query(
      `SELECT name, database_id AS id FROM sys.databases
        WHERE state = 0 AND HAS_DBACCESS(name) = 1
        ORDER BY name`,
    );
    return rows.map((r) => ({ name: String(r['name']), system: Number(r['id']) <= 4 }));
  }

  async listSchemas(database: string): Promise<DbObject[]> {
    const rows = await this.query(
      `SELECT name, schema_id AS id FROM ${bracket(database)}.sys.schemas ORDER BY name`,
    );
    return rows.map((r) => {
      const name = String(r['name']);
      // Los roles fijos de base de datos (db_owner…) tienen id ≥ 16384.
      return { name, system: SYSTEM_SCHEMAS.has(name) || Number(r['id']) >= 16384 };
    });
  }

  async countObjects(scope: Scope): Promise<Partial<Record<ObjectKind, number>>> {
    const rows = await this.query(
      `SELECT RTRIM(o.type) AS type, COUNT(*) AS n
         FROM ${bracket(scope.database)}.sys.objects o
         JOIN ${bracket(scope.database)}.sys.schemas s ON s.schema_id = o.schema_id
        WHERE s.name = @schema AND o.is_ms_shipped = 0
        GROUP BY o.type`,
      { schema: scope.schema },
    );
    const counts: Partial<Record<ObjectKind, number>> = {};
    for (const r of rows) {
      const kind = (Object.keys(OBJECT_TYPES) as ObjectKind[]).find((k) =>
        OBJECT_TYPES[k]!.includes(String(r['type'])),
      );
      if (kind) counts[kind] = (counts[kind] ?? 0) + Number(r['n']);
    }
    return counts;
  }

  async listObjects(scope: Scope, kind: ObjectKind): Promise<DbObject[]> {
    const types = OBJECT_TYPES[kind];
    if (!types) return [];
    const db = bracket(scope.database);
    const rows = await this.query(
      `SELECT o.name,
              ${
                kind === 'table'
                  ? `(SELECT SUM(p.rows) FROM ${db}.sys.partitions p
                       WHERE p.object_id = o.object_id AND p.index_id IN (0, 1))`
                  : 'NULL'
              } AS rows_estimate
         FROM ${db}.sys.objects o
         JOIN ${db}.sys.schemas s ON s.schema_id = o.schema_id
        WHERE s.name = @schema AND o.is_ms_shipped = 0
          AND o.type IN (${types.map((t) => `'${t}'`).join(', ')})
        ORDER BY o.name`,
      { schema: scope.schema },
    );
    return rows.map((r) => ({
      name: String(r['name']),
      detail: r['rows_estimate'] === null ? undefined : formatRowEstimate(Number(r['rows_estimate'])),
    }));
  }

  async getColumns(ref: ObjectRef): Promise<ColumnInfo[]> {
    const db = bracket(ref.database);
    const rows = await this.query(
      `SELECT c.name,
              CASE
                WHEN t.name IN ('nvarchar', 'nchar') THEN t.name + '(' + IIF(c.max_length = -1, 'max', CAST(c.max_length / 2 AS varchar(10))) + ')'
                WHEN t.name IN ('varchar', 'char', 'varbinary', 'binary') THEN t.name + '(' + IIF(c.max_length = -1, 'max', CAST(c.max_length AS varchar(10))) + ')'
                WHEN t.name IN ('decimal', 'numeric') THEN t.name + '(' + CAST(c.precision AS varchar(3)) + ',' + CAST(c.scale AS varchar(3)) + ')'
                WHEN t.name IN ('datetime2', 'time', 'datetimeoffset') THEN t.name + '(' + CAST(c.scale AS varchar(3)) + ')'
                ELSE t.name
              END AS type,
              c.is_nullable AS nullable,
              dc.definition AS def,
              CAST(IIF(EXISTS (
                SELECT 1 FROM ${db}.sys.index_columns ic
                  JOIN ${db}.sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                 WHERE i.is_primary_key = 1 AND ic.object_id = c.object_id AND ic.column_id = c.column_id
              ), 1, 0) AS bit) AS pk,
              CAST(ep.value AS nvarchar(4000)) AS comment
         FROM ${db}.sys.columns c
         JOIN ${db}.sys.objects o ON o.object_id = c.object_id
         JOIN ${db}.sys.schemas s ON s.schema_id = o.schema_id
         JOIN ${db}.sys.types t ON t.user_type_id = c.user_type_id
         LEFT JOIN ${db}.sys.default_constraints dc ON dc.object_id = c.default_object_id
         LEFT JOIN ${db}.sys.extended_properties ep
           ON ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.class = 1 AND ep.name = 'MS_Description'
        WHERE s.name = @schema AND o.name = @name
        ORDER BY c.column_id`,
      { schema: ref.schema, name: ref.name },
    );
    return rows.map((r) => ({
      name: String(r['name']),
      nativeType: String(r['type']),
      nullable: !!r['nullable'],
      defaultValue: r['def'] === null ? undefined : String(r['def']),
      primaryKey: !!r['pk'],
      comment: r['comment'] === null ? undefined : String(r['comment']),
    }));
  }

  async getIndexes(ref: ObjectRef): Promise<IndexInfo[]> {
    const db = bracket(ref.database);
    const rows = await this.query(
      `SELECT i.name AS index_name, i.is_unique AS is_unique, i.is_primary_key AS is_primary, c.name AS column_name
         FROM ${db}.sys.indexes i
         JOIN ${db}.sys.objects o ON o.object_id = i.object_id
         JOIN ${db}.sys.schemas s ON s.schema_id = o.schema_id
         JOIN ${db}.sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
         JOIN ${db}.sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE s.name = @schema AND o.name = @name AND i.type > 0 AND i.is_hypothetical = 0 AND ic.key_ordinal > 0
        ORDER BY i.is_primary_key DESC, i.name, ic.key_ordinal`,
      { schema: ref.schema, name: ref.name },
    );
    const byName = new Map<string, IndexInfo>();
    for (const r of rows) {
      const name = String(r['index_name']);
      let index = byName.get(name);
      if (!index) {
        index = { name, unique: !!r['is_unique'], primary: !!r['is_primary'], columns: [] };
        byName.set(name, index);
      }
      index.columns.push(String(r['column_name']));
    }
    return [...byName.values()];
  }

  async countRows(ref: ObjectRef): Promise<number> {
    const table = `${bracket(ref.database)}.${qualifiedName('sqlserver', { schema: ref.schema, name: ref.name })}`;
    const [row] = await this.query(`SELECT COUNT_BIG(*) AS n FROM ${table}`);
    return Number(row?.['n'] ?? 0);
  }

  async openSession(database: string | undefined): Promise<DbSession> {
    const db = database || this.defaultDatabase;
    const cfg = this.requireConfig();
    const connection = await this.open(db, 'DB Explorer (editor)', cfg.queryTimeoutSec * 1000);
    return new SqlServerSession(connection, db, (sql) => this.describe(db, sql));
  }

  /** Tipo exacto, tabla de origen y clave de las columnas del primer resultado de `sql`. */
  private async describe(database: string, sql: string): Promise<(DescribedColumn | undefined)[] | null> {
    const rows = await this.query(
      `EXEC ${bracket(database)}.sys.sp_executesql
         N'SELECT column_ordinal, is_hidden, system_type_name, source_schema, source_table, source_column,
                  is_part_of_unique_key
             FROM sys.dm_exec_describe_first_result_set(@tsql, NULL, 1)',
         N'@tsql nvarchar(max)', @tsql = @sql`,
      { sql },
    );
    if (rows.length === 0 || rows.some((r) => r['column_ordinal'] === null)) return null;
    return rows
      .filter((r) => !r['is_hidden'])
      .sort((a, b) => Number(a['column_ordinal']) - Number(b['column_ordinal']))
      .map((r) => ({
        nativeType: r['system_type_name'] === null ? '' : String(r['system_type_name']),
        sourceSchema: r['source_schema'] === null ? undefined : String(r['source_schema']),
        sourceTable: r['source_table'] === null ? undefined : String(r['source_table']),
        sourceColumn: r['source_column'] === null ? undefined : String(r['source_column']),
        isPk: r['source_table'] === null ? undefined : !!r['is_part_of_unique_key'],
      }));
  }

  /** Consulta de metadatos, en cola sobre la conexión compartida. */
  private query(sql: string, params: Record<string, Param> = {}): Promise<Row[]> {
    const run = async (): Promise<Row[]> => {
      const conn = await this.metadataConnection();
      return new Promise<Row[]>((resolve, reject) => {
        const rows: Row[] = [];
        const request = new Request(sql, (err) => (err ? reject(toSqlServerError(err)) : resolve(rows)));
        for (const [name, value] of Object.entries(params)) {
          request.addParameter(name, typeof value === 'number' ? TYPES.Int : TYPES.NVarChar, value);
        }
        request.on('row', (columns: { value: unknown; metadata: { colName: string } }[]) => {
          const row: Row = {};
          for (const c of columns) row[c.metadata.colName] = c.value;
          rows.push(row);
        });
        conn.execSql(request);
      });
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private metadataConnection(): Promise<Connection> {
    if (this.metadata) return this.metadata;
    const cfg = this.requireConfig();
    const created = this.open(cfg.database?.trim() || undefined, 'DB Explorer', METADATA_TIMEOUT_MS);
    this.metadata = created;
    created
      .then((conn) => {
        // Si se corta (red, reinicio del servidor), la siguiente consulta reconecta.
        conn.on('end', () => {
          if (this.metadata === created) this.metadata = null;
        });
      })
      .catch(() => {
        if (this.metadata === created) this.metadata = null;
      });
    return created;
  }

  /** Abre una conexión física con la configuración actual. */
  private open(database: string | undefined, appName: string, requestTimeoutMs: number): Promise<Connection> {
    const cfg = this.requireConfig();
    const instanceName = cfg.instance?.trim() || undefined;
    const options: ConnectionConfiguration = {
      server: cfg.host?.trim() || 'localhost',
      authentication: { type: 'default', options: { userName: cfg.user ?? '', password: this.secret ?? '' } },
      options: {
        // Con instancia con nombre, el puerto lo resuelve el servicio SQL Browser.
        port: instanceName ? undefined : (cfg.port ?? 1433),
        instanceName,
        database,
        encrypt: cfg.ssl?.encrypt ?? cfg.ssl?.mode !== 'disable',
        trustServerCertificate: cfg.ssl?.trustServerCertificate ?? false,
        connectTimeout: cfg.connectTimeoutSec * 1000,
        requestTimeout: requestTimeoutMs,
        readOnlyIntent: cfg.readOnly,
        appName,
        useColumnNames: false,
        rowCollectionOnRequestCompletion: false,
        rowCollectionOnDone: false,
      },
    };
    return new Promise<Connection>((resolve, reject) => {
      const conn = new Connection(options);
      conn.on('error', () => undefined);
      conn.connect((err) => {
        if (err) {
          conn.close();
          reject(toSqlServerError(err));
        } else {
          resolve(conn);
        }
      });
    });
  }

  private requireConfig(): ConnectionConfig {
    if (!this.config) throw new DriverError('La conexión no está abierta', 'not-connected');
    return this.config;
  }
}
