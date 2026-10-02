import type { ConnectionConfig, Engine, ServerInfo } from '@shared/connection';
import type {
  ColumnInfo,
  ConstraintInfo,
  DbObject,
  DriverCapabilities,
  IndexInfo,
  ObjectKind,
} from '@shared/metadata';
import type { CellValue, LogicalType, MessageSeverity, ResultColumn } from '@shared/query';

export interface Scope {
  database: string;
  schema: string;
}

export interface ObjectRef extends Scope {
  name: string;
}

/** Receptor de una sentencia en ejecución (specs/03 `ResultSink`, por sentencia). */
export interface StatementSink {
  columns(columns: ResultColumn[]): void;
  rows(batch: CellValue[][]): void;
  message(severity: MessageSeverity, text: string): void;
}

export interface StatementOutcome {
  command: string;
  /** Filas leídas (resultados) o afectadas (DML). */
  rowCount: number;
  affected?: number;
  /** Quedan filas sin leer en el cursor. */
  truncated: boolean;
}

/**
 * Sesión dedicada de una pestaña de editor (specs/03 §Sesiones): conserva
 * variables, tablas temporales y transacciones entre ejecuciones.
 */
export interface DbSession {
  readonly database: string;
  /** Cambia el esquema por defecto de la sesión. */
  setSchema(schema: string | undefined): Promise<void>;
  /**
   * Ejecuta una sentencia y entrega sus filas en lotes hasta `maxRows`
   * (`null` = todas). Si quedan filas, el cursor queda abierto para `fetchMore`.
   */
  execute(sql: string, maxRows: number | null, sink: StatementSink): Promise<StatementOutcome>;
  /** Lee más filas del cursor abierto. */
  fetchMore(count: number | null, sink: StatementSink): Promise<{ loaded: number; hasMore: boolean }>;
  /** Cierra el cursor abierto, si lo hay. */
  closeCursor(): Promise<void>;
  /** Cancela la sentencia en curso con el mecanismo nativo del motor. */
  cancel(): Promise<void>;
  close(): Promise<void>;
  /**
   * Modo de transacción (specs/04 §8). En manual, cada sentencia abre una
   * transacción si no hay una abierta; volver a auto-commit confirma la abierta.
   */
  setAutoCommit(on: boolean): Promise<void>;
  /** Confirma la transacción abierta, si la hay. */
  commit(): Promise<void>;
  /** Revierte la transacción abierta, si la hay. */
  rollback(): Promise<void>;
  /**
   * Ejecuta una sentencia sin resultados, con parámetros en el formato del
   * motor (`$1`, `?` o `@p1`). Devuelve las filas afectadas.
   */
  run(sql: string, params?: CellValue[], types?: LogicalType[]): Promise<number>;
}

/**
 * Interfaz común de los motores (specs/03). Conexión y metadatos usan una
 * conexión compartida; la ejecución, sesiones dedicadas por pestaña.
 */
export interface DbDriver {
  readonly engine: Engine;
  readonly capabilities: DriverCapabilities;

  connect(config: ConnectionConfig, secret?: string): Promise<ServerInfo>;
  disconnect(): Promise<void>;
  /** Latencia de una consulta trivial, en ms. */
  ping(): Promise<number>;

  listDatabases(): Promise<DbObject[]>;
  listSchemas(database: string): Promise<DbObject[]>;
  /** Cantidad de objetos por tipo en un esquema (para "Tablas (48)"). */
  countObjects(scope: Scope): Promise<Partial<Record<ObjectKind, number>>>;
  listObjects(scope: Scope, kind: ObjectKind): Promise<DbObject[]>;
  getColumns(ref: ObjectRef): Promise<ColumnInfo[]>;
  getIndexes(ref: ObjectRef): Promise<IndexInfo[]>;
  /** Clave primaria, claves foráneas, únicas y CHECK. */
  getConstraints(ref: ObjectRef): Promise<ConstraintInfo[]>;
  /** Sentencia de creación del objeto. */
  getDDL(ref: ObjectRef, kind: ObjectKind): Promise<string>;
  /** `SELECT count(*)` de una tabla o vista. */
  countRows(ref: ObjectRef): Promise<number>;

  /** Abre una sesión dedicada en `database` (sin valor: la predeterminada). */
  openSession(database: string | undefined, schema: string | undefined): Promise<DbSession>;
}

/** Error de base de datos con mensaje apto para mostrar (nunca incluye credenciales). */
export class DriverError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    /** Datos adicionales del motor (posición del error, detalle, sugerencia). */
    readonly extra: { position?: number; detail?: string; hint?: string } = {},
  ) {
    super(message);
    this.name = 'DriverError';
  }
}
