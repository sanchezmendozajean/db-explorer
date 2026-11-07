import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newConnectionDefaults } from '@shared/connection';
import type { SchemaDiagram } from '@shared/metadata';
import { SqliteDriver } from '../../src/db-host/drivers/sqlite/sqlite-driver';

const dir = mkdtempSync(join(tmpdir(), 'dbx-sqlite-er-'));
const driver = new SqliteDriver();
const scope = { database: 'main', schema: 'main' };
let diagram: SchemaDiagram;

beforeAll(async () => {
  await driver.connect({
    ...newConnectionDefaults('sqlite', 'er'),
    file: join(dir, 'er.db'),
    sqliteCreate: true,
  });
  const session = await driver.openSession();
  for (const sql of [
    'CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre VARCHAR(100) NOT NULL)',
    'CREATE TABLE pedidos (id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES clientes (id), nota TEXT)',
    // La clave primaria compuesta es a la vez clave foránea, y `REFERENCES pedidos` sin columnas apunta a su PK.
    'CREATE TABLE detalle (pedido_id INTEGER NOT NULL, linea INTEGER NOT NULL, PRIMARY KEY (pedido_id, linea), FOREIGN KEY (pedido_id) REFERENCES pedidos)',
    'CREATE TABLE paises (a TEXT NOT NULL, b TEXT NOT NULL, PRIMARY KEY (a, b))',
    'CREATE TABLE ciudades (id INTEGER PRIMARY KEY, a TEXT, b TEXT, FOREIGN KEY (a, b) REFERENCES paises (a, b))',
    'CREATE TABLE empleados (id INTEGER PRIMARY KEY, jefe_id INTEGER REFERENCES empleados (id))',
    // Destino que no existe: SQLite lo permite.
    'CREATE TABLE huerfana (x INTEGER REFERENCES inexistente (id))',
    'CREATE VIEW vista_clientes AS SELECT id FROM clientes',
  ]) {
    await session.run(sql);
  }
  await session.close();
  diagram = await driver.getSchemaDiagram(scope);
});

afterAll(async () => {
  await driver.disconnect();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    // Queda en la carpeta temporal del sistema.
  }
});

describe('SQLite: getSchemaDiagram', () => {
  it('lista solo las tablas, ordenadas por nombre, con sus columnas', () => {
    expect(diagram.tables.map((t) => t.name)).toEqual([
      'ciudades',
      'clientes',
      'detalle',
      'empleados',
      'huerfana',
      'paises',
      'pedidos',
    ]);
    const pedidos = diagram.tables.find((t) => t.name === 'pedidos')!;
    expect(pedidos.columns).toEqual([
      { name: 'id', nativeType: 'INTEGER', nullable: false, primaryKey: true },
      { name: 'cliente_id', nativeType: 'INTEGER', nullable: false, primaryKey: false },
      { name: 'nota', nativeType: 'TEXT', nullable: true, primaryKey: false },
    ]);
  });

  it('devuelve las claves foráneas con tabla y columnas de cada lado', () => {
    const rel = (table: string) => diagram.relations.filter((r) => r.from.table === table);
    expect(rel('pedidos')).toEqual([
      {
        name: '',
        from: { schema: 'main', table: 'pedidos', columns: ['cliente_id'] },
        to: { schema: 'main', table: 'clientes', columns: ['id'] },
      },
    ]);
    expect(rel('empleados')[0]).toMatchObject({
      from: { table: 'empleados', columns: ['jefe_id'] },
      to: { table: 'empleados', columns: ['id'] },
    });
  });

  it('una clave foránea compuesta es una sola relación con las columnas en orden', () => {
    const [fk, ...rest] = diagram.relations.filter((r) => r.from.table === 'ciudades');
    expect(rest).toHaveLength(0);
    expect(fk!.from.columns).toEqual(['a', 'b']);
    expect(fk!.to).toEqual({ schema: 'main', table: 'paises', columns: ['a', 'b'] });
  });

  it('`REFERENCES tabla` sin columnas apunta a la clave primaria de esa tabla', () => {
    const fk = diagram.relations.find((r) => r.from.table === 'detalle')!;
    expect(fk.to.columns).toEqual(['id']);
  });

  it('un destino inexistente se informa igual, con las columnas que declara', () => {
    const fk = diagram.relations.find((r) => r.from.table === 'huerfana')!;
    expect(fk.to).toEqual({ schema: 'main', table: 'inexistente', columns: ['id'] });
  });

  it('getConstraints también entrega el destino estructurado de las claves foráneas', async () => {
    const constraints = await driver.getConstraints({ ...scope, name: 'ciudades' });
    const fk = constraints.find((c) => c.type === 'foreignKey')!;
    expect(fk.references).toEqual({ schema: 'main', table: 'paises', columns: ['a', 'b'] });
    expect(fk.definition).toContain('REFERENCES');
  });
});
