import type { ConnectionConfiguration } from 'tedious';
import { Connection, Request, TYPES } from 'tedious';
import type { ConnectionConfig, ServerInfo } from '@shared/connection';
import type {
  ColumnInfo,
  ConstraintInfo,
  DbObject,
  DriverCapabilities,
  IndexInfo,
  ObjectKind,
} from '@shared/metadata';
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

  async getConstraints(ref: ObjectRef): Promise<ConstraintInfo[]> {
    const params = { full: `${bracket(ref.schema)}.${bracket(ref.name)}` };
    const keys = await this.queryIn(
      ref.database,
      `SELECT kc.name, kc.type, c.name AS col
         FROM sys.key_constraints kc
         JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
         JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE kc.parent_object_id = OBJECT_ID(@full) AND ic.key_ordinal > 0
        ORDER BY kc.type, kc.name, ic.key_ordinal`,
      params,
    );
    const fks = await this.queryIn(
      ref.database,
      `SELECT fk.name, pc.name AS col, rc.name AS ref_col,
              QUOTENAME(OBJECT_SCHEMA_NAME(fk.referenced_object_id)) + '.' + QUOTENAME(OBJECT_NAME(fk.referenced_object_id)) AS ref_table,
              fk.delete_referential_action_desc AS on_delete, fk.update_referential_action_desc AS on_update
         FROM sys.foreign_keys fk
         JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
         JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
         JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
        WHERE fk.parent_object_id = OBJECT_ID(@full)
        ORDER BY fk.name, fkc.constraint_column_id`,
      params,
    );
    const checks = await this.queryIn(
      ref.database,
      `SELECT cc.name, cc.definition, c.name AS col
         FROM sys.check_constraints cc
         LEFT JOIN sys.columns c ON c.object_id = cc.parent_object_id AND c.column_id = cc.parent_column_id
        WHERE cc.parent_object_id = OBJECT_ID(@full)
        ORDER BY cc.name`,
      params,
    );
    const q = (cols: string[]): string => cols.map(bracket).join(', ');
    const result: ConstraintInfo[] = [];
    const group = (rows: Row[]): Map<string, Row[]> => {
      const map = new Map<string, Row[]>();
      for (const r of rows) map.set(String(r['name']), [...(map.get(String(r['name'])) ?? []), r]);
      return map;
    };
    for (const [name, rows] of group(keys)) {
      const primary = String(rows[0]!['type']).trim() === 'PK';
      const cols = rows.map((r) => String(r['col']));
      result.push({
        name,
        type: primary ? 'primaryKey' : 'unique',
        columns: cols,
        definition: `${primary ? 'PRIMARY KEY' : 'UNIQUE'} (${q(cols)})`,
      });
    }
    result.sort((a, b) => Number(b.type === 'primaryKey') - Number(a.type === 'primaryKey'));
    for (const [name, rows] of group(fks)) {
      const first = rows[0]!;
      const cols = rows.map((r) => String(r['col']));
      let definition = `FOREIGN KEY (${q(cols)}) REFERENCES ${String(first['ref_table'])} (${q(rows.map((r) => String(r['ref_col'])))})`;
      for (const [action, label] of [
        ['on_delete', 'ON DELETE'],
        ['on_update', 'ON UPDATE'],
      ] as const) {
        const value = String(first[action]);
        if (value !== 'NO_ACTION') definition += ` ${label} ${value.replace(/_/g, ' ')}`;
      }
      result.push({ name, type: 'foreignKey', columns: cols, definition });
    }
    for (const r of checks) {
      result.push({
        name: String(r['name']),
        type: 'check',
        columns: r['col'] === null ? [] : [String(r['col'])],
        definition: `CHECK ${String(r['definition'])}`,
      });
    }
    return result;
  }

  async getDDL(ref: ObjectRef, kind: ObjectKind): Promise<string> {
    const full = `${bracket(ref.schema)}.${bracket(ref.name)}`;
    if (kind === 'view' || kind === 'function' || kind === 'procedure') {
      const [row] = await this.queryIn(ref.database, 'SELECT OBJECT_DEFINITION(OBJECT_ID(@full)) AS def', {
        full,
      });
      return row?.['def'] === null || row?.['def'] === undefined ? '' : String(row['def']).trim();
    }
    if (kind === 'sequence') {
      const [s] = await this.queryIn(
        ref.database,
        `SELECT TYPE_NAME(user_type_id) AS type, CAST(start_value AS nvarchar(40)) AS start_value,
                CAST(increment AS nvarchar(40)) AS inc, CAST(minimum_value AS nvarchar(40)) AS min_value,
                CAST(maximum_value AS nvarchar(40)) AS max_value, is_cycling, is_cached, cache_size
           FROM sys.sequences WHERE object_id = OBJECT_ID(@full)`,
        { full },
      );
      if (!s) return '';
      const cache = s['is_cached']
        ? s['cache_size'] === null
          ? 'CACHE'
          : `CACHE ${String(s['cache_size'])}`
        : 'NO CACHE';
      return [
        `CREATE SEQUENCE ${full}`,
        `    AS ${String(s['type'])}`,
        `    START WITH ${String(s['start_value'])}`,
        `    INCREMENT BY ${String(s['inc'])}`,
        `    MINVALUE ${String(s['min_value'])}`,
        `    MAXVALUE ${String(s['max_value'])}`,
        `    ${s['is_cycling'] ? 'CYCLE' : 'NO CYCLE'}`,
        `    ${cache};`,
      ].join('\n');
    }
    return this.tableDDL(ref, full);
  }

  /** `CREATE TABLE` armado desde el catálogo, con sus restricciones e índices. */
  private async tableDDL(ref: ObjectRef, full: string): Promise<string> {
    const columns = await this.queryIn(
      ref.database,
      `SELECT c.name,
              CASE
                WHEN t.name IN ('nvarchar', 'nchar') THEN t.name + '(' + IIF(c.max_length = -1, 'max', CAST(c.max_length / 2 AS varchar(10))) + ')'
                WHEN t.name IN ('varchar', 'char', 'varbinary', 'binary') THEN t.name + '(' + IIF(c.max_length = -1, 'max', CAST(c.max_length AS varchar(10))) + ')'
                WHEN t.name IN ('decimal', 'numeric') THEN t.name + '(' + CAST(c.precision AS varchar(3)) + ',' + CAST(c.scale AS varchar(3)) + ')'
                WHEN t.name IN ('datetime2', 'time', 'datetimeoffset') THEN t.name + '(' + CAST(c.scale AS varchar(3)) + ')'
                ELSE t.name
              END AS type,
              c.is_nullable, cc.definition AS computed, dc.name AS default_name, dc.definition AS default_def,
              CAST(ic.seed_value AS nvarchar(40)) AS seed, CAST(ic.increment_value AS nvarchar(40)) AS inc
         FROM sys.columns c
         JOIN sys.types t ON t.user_type_id = c.user_type_id
         LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id
         LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
         LEFT JOIN sys.identity_columns ic ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE c.object_id = OBJECT_ID(@full)
        ORDER BY c.column_id`,
      { full },
    );
    const lines = columns.map((c) => {
      const name = bracket(String(c['name']));
      if (c['computed'] !== null) return `    ${name} AS ${String(c['computed'])}`;
      let line = `    ${name} ${String(c['type'])}`;
      if (c['seed'] !== null) line += ` IDENTITY(${String(c['seed'])}, ${String(c['inc'])})`;
      line += c['is_nullable'] ? ' NULL' : ' NOT NULL';
      if (c['default_def'] !== null) {
        line += ` CONSTRAINT ${bracket(String(c['default_name']))} DEFAULT ${String(c['default_def'])}`;
      }
      return line;
    });
    for (const c of await this.getConstraints(ref)) {
      lines.push(`    CONSTRAINT ${bracket(c.name)} ${c.definition ?? ''}`);
    }
    const indexRows = await this.queryIn(
      ref.database,
      `SELECT i.name, i.is_unique, i.type_desc, i.filter_definition, c.name AS col, ic.is_descending_key,
              ic.is_included_column
         FROM sys.indexes i
         JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
         JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE i.object_id = OBJECT_ID(@full) AND i.type > 0 AND i.is_hypothetical = 0
          AND i.is_primary_key = 0 AND i.is_unique_constraint = 0
        ORDER BY i.name, ic.is_included_column, ic.key_ordinal, ic.index_column_id`,
      { full },
    );
    const indexes = new Map<string, Row[]>();
    for (const r of indexRows) indexes.set(String(r['name']), [...(indexes.get(String(r['name'])) ?? []), r]);
    const parts = [`CREATE TABLE ${full} (\n${lines.join(',\n')}\n);`];
    const creates = [...indexes].map(([name, rows]) => {
      const first = rows[0]!;
      const keys = rows
        .filter((r) => !r['is_included_column'])
        .map((r) => `${bracket(String(r['col']))}${r['is_descending_key'] ? ' DESC' : ''}`);
      const included = rows.filter((r) => r['is_included_column']).map((r) => bracket(String(r['col'])));
      let sql = `CREATE ${first['is_unique'] ? 'UNIQUE ' : ''}${String(first['type_desc'])} INDEX ${bracket(name)} ON ${full} (${keys.join(', ')})`;
      if (included.length > 0) sql += ` INCLUDE (${included.join(', ')})`;
      if (first['filter_definition'] !== null) sql += ` WHERE ${String(first['filter_definition'])}`;
      return `${sql};`;
    });
    if (creates.length > 0) parts.push(creates.join('\n'));
    return parts.join('\n\n');
  }

  /** Consulta de metadatos ejecutada en el contexto de otra base (para `OBJECT_ID`, `OBJECT_DEFINITION`…). */
  private queryIn(database: string, sql: string, params: Record<string, string>): Promise<Row[]> {
    const names = Object.keys(params);
    const declare = names.map((n) => `@${n} nvarchar(max)`).join(', ');
    const assign = names.map((n) => `@${n} = @${n}`).join(', ');
    return this.query(
      `EXEC ${bracket(database)}.sys.sp_executesql @stmt, N'${declare}'${assign ? `, ${assign}` : ''}`,
      { stmt: sql, ...params },
    );
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
