import type { ConnectionConfig, Engine, ServerInfo } from '@shared/connection';
import type { TreeNodeData, TreeNodeRef } from '@shared/metadata';
import type { ExecuteRequest, ExecuteSummary, FetchMoreRequest, FetchMoreResult } from '@shared/query';
import type { DbDriver, ObjectRef } from './drivers/types';
import { DriverError } from './drivers/types';
import { MariaDbDriver } from './drivers/mariadb/mariadb-driver';
import { PostgresDriver } from './drivers/postgres/postgres-driver';
import { SqliteDriver } from './drivers/sqlite/sqlite-driver';
import { SqlServerDriver } from './drivers/sqlserver/sqlserver-driver';
import type { EmitQueryEvent } from './query-runner';
import { QueryRunner } from './query-runner';
import { childrenOf } from './tree';

export type DriverFactory = (engine: Engine) => DbDriver;

export const defaultDriverFactory: DriverFactory = (engine) => {
  switch (engine) {
    case 'postgres':
      return new PostgresDriver();
    case 'sqlite':
      return new SqliteDriver();
    case 'sqlserver':
      return new SqlServerDriver();
    case 'mariadb':
      return new MariaDbDriver();
  }
};

interface OpenConnection {
  config: ConnectionConfig;
  driver: DbDriver;
}

/**
 * Conexiones abiertas en el db-host: una de metadatos por conexión configurada
 * y las sesiones de editor (en `QueryRunner`). Las contraseñas solo viven
 * aquí, en memoria, mientras la conexión está abierta.
 */
export class ConnectionManager {
  private readonly open = new Map<string, OpenConnection>();
  readonly queries: QueryRunner;

  constructor(
    private readonly createDriver: DriverFactory = defaultDriverFactory,
    emit: EmitQueryEvent = () => undefined,
  ) {
    this.queries = new QueryRunner((id) => this.get(id).driver, emit);
  }

  /** Conecta y desconecta de inmediato; no conserva nada. */
  async test(config: ConnectionConfig, secret?: string): Promise<ServerInfo> {
    const driver = this.createDriver(config.engine);
    try {
      return await driver.connect(config, secret);
    } finally {
      await driver.disconnect().catch(() => undefined);
    }
  }

  async connect(config: ConnectionConfig, secret?: string): Promise<ServerInfo> {
    await this.disconnect(config.id);
    const driver = this.createDriver(config.engine);
    try {
      const info = await driver.connect(config, secret);
      this.open.set(config.id, { config, driver });
      return info;
    } catch (err) {
      await driver.disconnect().catch(() => undefined);
      throw err;
    }
  }

  async disconnect(id: string): Promise<void> {
    await this.queries.closeConnection(id);
    const conn = this.open.get(id);
    if (!conn) return;
    this.open.delete(id);
    await conn.driver.disconnect().catch(() => undefined);
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.open.keys()].map((id) => this.disconnect(id)));
  }

  isOpen(id: string): boolean {
    return this.open.has(id);
  }

  async children(id: string, ref: TreeNodeRef): Promise<TreeNodeData[]> {
    const conn = this.get(id);
    return childrenOf(conn.driver, conn.config, ref);
  }

  countRows(id: string, ref: ObjectRef): Promise<number> {
    return this.get(id).driver.countRows(ref);
  }

  execute(req: ExecuteRequest): Promise<ExecuteSummary> {
    return this.queries.execute(req);
  }

  fetchMore(req: FetchMoreRequest): Promise<FetchMoreResult> {
    return this.queries.fetchMore(req);
  }

  private get(id: string): OpenConnection {
    const conn = this.open.get(id);
    if (!conn) throw new DriverError('La conexión no está abierta', 'not-connected');
    return conn;
  }
}
