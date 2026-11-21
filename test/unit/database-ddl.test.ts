import { describe, expect, it } from 'vitest';
import { databaseDdl } from '../../src/db-host/database-ddl';
import type { DbDriver } from '../../src/db-host/drivers/types';

/** Driver mínimo: solo lo que usa `databaseDdl`. */
function fakeDriver(engine: 'postgres' | 'sqlserver'): DbDriver {
  const tables = ['pedidos', 'clientes'];
  return {
    engine,
    capabilities: {
      databases: true,
      schemas: true,
      functions: false,
      procedures: false,
      sequences: false,
      triggers: false,
      materializedViews: false,
      cancel: true,
      multipleResultSets: false,
      ...(engine === 'sqlserver' ? { batchSeparator: 'GO' as const } : {}),
    },
    listSchemas: () => Promise.resolve([{ name: 'ventas' }, { name: 'pg_catalog', system: true }]),
    listObjects: (_scope: unknown, kind: string) =>
      Promise.resolve(kind === 'table' ? tables.map((name) => ({ name })) : []),
    getConstraints: (ref: { name: string }) =>
      Promise.resolve(
        ref.name === 'pedidos'
          ? [{ name: 'fk', type: 'foreignKey', columns: ['c'], references: { schema: 'ventas', table: 'clientes', columns: ['id'] } }]
          : [],
      ),
    getDDL: (ref: { name: string }) => Promise.resolve(`CREATE TABLE ${ref.name} ()`),
  } as unknown as DbDriver;
}

describe('databaseDdl', () => {
  it('crea el esquema y ordena las tablas según sus claves foráneas', async () => {
    const ddl = await databaseDdl(fakeDriver('postgres'), 'erp');
    expect(ddl).toContain('CREATE SCHEMA IF NOT EXISTS ventas;');
    expect(ddl).not.toContain('pg_catalog');
    expect(ddl.indexOf('CREATE TABLE clientes')).toBeLessThan(ddl.indexOf('CREATE TABLE pedidos'));
    expect(ddl).toContain('CREATE TABLE pedidos ();');
  });

  it('en SQL Server separa cada objeto con GO', async () => {
    const ddl = await databaseDdl(fakeDriver('sqlserver'), 'erp');
    expect(ddl).toContain('CREATE SCHEMA ventas;\nGO');
    expect(ddl).toContain('CREATE TABLE clientes ()\nGO');
  });
});
