import type { ConnectionConfig, Engine, ServerInfo } from '@shared/connection';
import type { TreeNodeData, TreeNodeRef } from '@shared/metadata';
import type { DbDriver } from './drivers/types';
import { DriverError } from './drivers/types';
import { PostgresDriver } from './drivers/postgres/postgres-driver';
import { childrenOf } from './tree';

export type DriverFactory = (engine: Engine) => DbDriver;

export const defaultDriverFactory: DriverFactory = (engine) => {
  switch (engine) {
    case 'postgres':
      return new PostgresDriver();
    default:
      // MariaDB, SQLite y SQL Server llegan en el hito M4.
      throw new DriverError(`El motor "${engine}" todavía no está disponible`, 'engine-unavailable');
  }
};

interface OpenConnection {
  config: ConnectionConfig;
  driver: DbDriver;
}

/**
 * Conexiones de metadatos abiertas en el db-host (una por conexión configurada).
 * Las contraseñas solo viven aquí, en memoria, mientras la conexión está abierta.
 */
export class ConnectionManager {
  private readonly open = new Map<string, OpenConnection>();

  constructor(private readonly createDriver: DriverFactory = defaultDriverFactory) {}

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
    const conn = this.open.get(id);
    if (!conn) throw new DriverError('La conexión no está abierta', 'not-connected');
    return childrenOf(conn.driver, conn.config, ref);
  }
}
