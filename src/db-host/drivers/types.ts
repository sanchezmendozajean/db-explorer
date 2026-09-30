import type { ConnectionConfig, Engine, ServerInfo } from '@shared/connection';
import type { ColumnInfo, DbObject, DriverCapabilities, IndexInfo, ObjectKind } from '@shared/metadata';

export interface Scope {
  database: string;
  schema: string;
}

export interface ObjectRef extends Scope {
  name: string;
}

/**
 * Interfaz común de los motores (specs/03). En M2 se implementa la parte de
 * conexión y metadatos; ejecución, sesiones y transacciones llegan en M3.
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
}

/** Error de base de datos con mensaje apto para mostrar (nunca incluye credenciales). */
export class DriverError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'DriverError';
  }
}
