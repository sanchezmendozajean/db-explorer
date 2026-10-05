import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExecutionPlan, PlanNode } from '@shared/plan';
import { walkPlan } from '@shared/plan';
import { buildPlan } from '../../src/db-host/drivers/plan-builder';
import { parsePostgresPlan, seqScanTables } from '../../src/db-host/drivers/postgres/plan';
import { parseMariaDbPlan, parseMySqlTreePlan, planTables } from '../../src/db-host/drivers/mariadb/plan';
import { parseSqlitePlan } from '../../src/db-host/drivers/sqlite/plan';
import { parseSqlServerPlan } from '../../src/db-host/drivers/sqlserver/plan';

/** Planes reales capturados de cada motor (tablas `plan_pedidos` de 20 000 filas y `plan_clientes` de 100). */
const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', 'plans', name), 'utf8');

const nodes = (plan: ExecutionPlan): PlanNode[] => [...walkPlan(plan.roots)];
const find = (plan: ExecutionPlan, operation: string, object?: string): PlanNode => {
  const node = nodes(plan).find(
    (n) => n.operation === operation && (object === undefined || n.object?.includes(object)),
  );
  if (!node)
    throw new Error(
      `Sin nodo ${operation} ${object ?? ''}: ${nodes(plan)
        .map((n) => n.operation)
        .join(', ')}`,
    );
  return node;
};
const kinds = (node: PlanNode): string[] => node.warnings.map((w) => w.kind);

describe('plan de PostgreSQL', () => {
  it('estimado: árbol con costos, condiciones y recorrido completo', () => {
    const plan = parsePostgresPlan(fixture('postgres-join-estimated.json'), 'SELECT …', false);
    expect(plan.analyzed).toBe(false);
    expect(plan.rawLanguage).toBe('json');
    expect(nodes(plan).map((n) => n.operation)).toEqual([
      'Sort',
      'HashAggregate',
      'Hash Join',
      'Seq Scan',
      'Hash',
      'Seq Scan',
    ]);
    const join = find(plan, 'Hash Join');
    expect(join.condition).toBe('(p.cliente_id = c.id)');
    const scan = find(plan, 'Seq Scan', 'plan_pedidos');
    expect(scan).toMatchObject({
      object: 'comun.plan_pedidos',
      alias: 'p',
      condition: "(p.total > '10'::numeric)",
    });
    // Sin estadísticas del catálogo, las filas estimadas tras el filtro (19 778) cuentan como leídas.
    expect(kinds(scan)).toEqual(['fullScan']);
    expect(kinds(find(plan, 'Seq Scan', 'plan_clientes'))).toEqual([]);
    expect(scan.actualRows).toBeUndefined();
    expect(plan.totalCost).toBe(plan.roots[0]!.totalCost);
    // Costo propio = total − hijos.
    const root = plan.roots[0]!;
    expect(root.selfCost).toBeCloseTo(root.totalCost! - root.children[0]!.totalCost!, 3);
  });

  it('real: filas, bucles, tiempos propios y tiempos de planificación y ejecución', () => {
    const plan = parsePostgresPlan(
      fixture('postgres-join-analyzed.json'),
      'SELECT …',
      true,
      new Map([['comun.plan_pedidos', 20000]]),
    );
    expect(plan).toMatchObject({ analyzed: true, planningMs: 0.224, executionMs: 5.464 });
    const scan = find(plan, 'Seq Scan', 'plan_pedidos');
    expect(scan).toMatchObject({ actualRows: 19780, loops: 1, estimatedRows: 19778 });
    expect(scan.warnings).toEqual([{ kind: 'fullScan', rows: 20000 }]);
    const join = find(plan, 'Hash Join');
    // 3,129 ms incluidos − 1,497 (Seq Scan) − 0,025 (Hash).
    expect(join.actualTimeMs).toBeCloseTo(3.129 - 1.497 - 0.025, 3);
    const groups = new Set(scan.properties.map((p) => p.group));
    expect(groups).toEqual(new Set(['general', 'estimated', 'actual']));
    expect(scan.properties).toContainEqual({
      group: 'actual',
      label: 'Rows Removed by Filter',
      value: '220',
    });
  });

  it('DELETE explicado y ejecutado, y orden que usa disco', () => {
    const del = parsePostgresPlan(fixture('postgres-delete-analyzed.json'), 'DELETE …', true);
    expect(del.roots[0]).toMatchObject({ operation: 'Delete', object: 'comun.plan_pedidos' });
    expect(find(del, 'Index Scan').condition).toBe('(plan_pedidos.id < 100)');
    const sort = parsePostgresPlan(fixture('postgres-sort-spill.json'), 'SELECT …', true);
    expect(kinds(sort.roots[0]!)).toContain('spill');
    expect(seqScanTables(fixture('postgres-sort-spill.json'))).toEqual([
      { schema: 'comun', name: 'plan_pedidos' },
    ]);
  });
});

describe('plan de MariaDB y MySQL', () => {
  it('MariaDB estimado: bloques, orden, tabla temporal y bucle anidado', () => {
    const plan = parseMariaDbPlan(fixture('mariadb-join-estimated.json'), 'SELECT …', false);
    expect(nodes(plan).map((n) => n.operation)).toEqual([
      'Query block #1',
      'Filesort',
      'Temporary table',
      'Nested loop',
      'Table scan',
      'Unique index lookup',
    ]);
    const scan = find(plan, 'Table scan');
    expect(scan).toMatchObject({
      object: 'p',
      estimatedRows: 19874,
      condition: 'p.total > 10 and p.cliente_id is not null',
    });
    expect(scan.warnings).toEqual([{ kind: 'fullScan', rows: 19874 }]);
    expect(find(plan, 'Unique index lookup').condition).toBe('PRIMARY = dbx_test.p.cliente_id');
    expect(find(plan, 'Filesort').warnings).toEqual([{ kind: 'engine', message: 'Using filesort' }]);
    expect(find(plan, 'Temporary table').warnings).toEqual([{ kind: 'engine', message: 'Using temporary' }]);
    expect(plan.totalCost).toBeCloseTo(21.109, 3);
  });

  it('MariaDB real: filas por bucle × bucles y tiempos propios', () => {
    const plan = parseMariaDbPlan(fixture('mariadb-join-analyzed.json'), 'SELECT …', true);
    expect(plan.planningMs).toBeCloseTo(0.112, 3);
    expect(plan.executionMs).toBeCloseTo(15.311, 3);
    const lookup = find(plan, 'Unique index lookup');
    expect(lookup).toMatchObject({ actualRows: 19780, loops: 19780, estimatedRows: 1 });
    expect(lookup.actualTimeMs).toBeCloseTo(5.483 + 6.54, 2);
    expect(find(plan, 'Filesort').actualTimeMs).toBeCloseTo(0.045, 3);
    const del = parseMariaDbPlan(fixture('mariadb-delete-analyzed.json'), 'DELETE …', true);
    expect(nodes(del).map((n) => n.operation)).toEqual(['Query block #1', 'Index range scan']);
    expect(planTables(fixture('mariadb-join-estimated.json'))).toEqual(['p', 'c']);
  });

  it('MySQL 8: árbol de texto estimado y real', () => {
    const est = parseMySqlTreePlan(fixture('mysql-join-estimated.txt'), 'SELECT …', false);
    expect(est.rawLanguage).toBe('plaintext');
    expect(nodes(est).map((n) => n.operation)).toEqual([
      'Sort',
      'Table scan',
      'Aggregate using temporary table',
      'Nested loop inner join',
      'Filter',
      'Table scan',
      'Single-row index lookup',
    ]);
    const scan = nodes(est).find((n) => n.object === 'p')!;
    expect(scan.warnings).toEqual([{ kind: 'fullScan', rows: 19880 }]);
    expect(nodes(est).find((n) => n.object === '<temporary>')!.warnings).toEqual([]);
    expect(find(est, 'Single-row index lookup')).toMatchObject({
      object: 'c',
      condition: 'using PRIMARY (id=p.cliente_id)',
    });
    expect(find(est, 'Filter').condition).toBe('((p.total > 10.00) and (p.cliente_id is not null))');

    const real = parseMySqlTreePlan(fixture('mysql-join-analyzed.txt'), 'SELECT …', true);
    const lookup = find(real, 'Single-row index lookup');
    expect(lookup).toMatchObject({ actualRows: 19780, loops: 19780 });
    expect(lookup.actualTimeMs).toBeCloseTo(0.000356 * 19780, 3);
    const loop = find(real, 'Nested loop inner join');
    expect(loop.actualTimeMs).toBeCloseTo(14.3 - 5.68 - lookup.actualTimeMs!, 3);
  });
});

describe('plan de SQLite', () => {
  const rows = (name: string) =>
    (JSON.parse(fixture(name)) as string[][]).map(([id, parent, , detail]) => ({
      id: Number(id),
      parent: Number(parent),
      detail: detail!,
    }));

  it('arma el árbol por padre, sin costos', () => {
    const plan = parseSqlitePlan(rows('sqlite-join.json'), 'SELECT …');
    expect(plan.roots.map((n) => [n.operation, n.object ?? null])).toEqual([
      ['SCAN', 'p'],
      ['SEARCH', 'c'],
      ['USE TEMP B-TREE FOR GROUP BY', null],
      ['USE TEMP B-TREE FOR ORDER BY', null],
    ]);
    expect(plan.roots[1]!.condition).toBe('USING INTEGER PRIMARY KEY (rowid=?)');
    expect(plan.totalCost).toBeUndefined();
    const sub = parseSqlitePlan(rows('sqlite-subquery.json'), 'SELECT …');
    expect(sub.roots).toHaveLength(1);
    expect(sub.roots[0]!.children.map((n) => n.operation)).toEqual(['LEFT-MOST SUBQUERY', 'UNION ALL']);
    expect(find(sub, 'SCAN', 'plan_pedidos')).toBeDefined();
  });
});

describe('plan de SQL Server', () => {
  it('estimado: operadores, objetos con alias, búsqueda de índice e índice faltante', () => {
    const plan = parseSqlServerPlan([fixture('sqlserver-join-estimated.xml')], 'SELECT …', false);
    expect(plan.rawLanguage).toBe('xml');
    const scan = find(plan, 'Clustered Index Scan');
    expect(scan.object).toMatch(/^comun\.plan_pedidos\.PK__plan_ped/);
    expect(scan.alias).toBe('p');
    expect(scan.condition).toBe('p.total>(10.00)');
    expect(scan.warnings).toContainEqual({ kind: 'fullScan', rows: 20000 });
    const seek = find(plan, 'Clustered Index Seek');
    expect(seek.condition).toBe('c.id = p.cliente_id');
    const root = plan.roots[0]!;
    expect(root.warnings.some((w) => w.kind === 'engine' && w.message.startsWith('Missing index'))).toBe(
      true,
    );
    expect(plan.totalCost).toBeCloseTo(root.totalCost!, 3);
    expect(scan.actualRows).toBeUndefined();
  });

  it('real: filas, ejecuciones, tiempos y DELETE', () => {
    const plan = parseSqlServerPlan([fixture('sqlserver-join-analyzed.xml')], 'SELECT …', true);
    const seek = find(plan, 'Clustered Index Seek');
    expect(seek).toMatchObject({ actualRows: 100, loops: 100 });
    expect(find(plan, 'Clustered Index Scan').actualRows).toBe(19780);
    expect(plan.executionMs).toBeGreaterThanOrEqual(0);
    expect(nodes(plan).every((n) => n.actualTimeMs !== undefined)).toBe(true);
    const del = parseSqlServerPlan([fixture('sqlserver-delete-analyzed.xml')], 'DELETE …', true);
    expect(del.roots[0]!.operation).toMatch(/Delete/);
    expect(nodes(del).some((n) => n.actualRows !== undefined && n.actualRows > 0)).toBe(true);
  });
});

describe('cálculos comunes', () => {
  it('estimación errada por bucle y umbrales', () => {
    const plan = buildPlan(
      { engine: 'postgres', analyzed: true, statement: 'x', raw: '', rawLanguage: 'json' },
      [
        {
          operation: 'Nested Loop',
          totalCost: 10,
          inclusiveTimeMs: 5,
          properties: [],
          children: [
            // 50 por bucle estimadas, 5 000 reales por bucle: errada.
            {
              operation: 'A',
              estimatedRows: 50,
              actualRows: 50_000,
              loops: 10,
              totalCost: 4,
              inclusiveTimeMs: 3,
              properties: [],
              children: [],
            },
            // Ninguna supera 100: no se marca.
            {
              operation: 'B',
              estimatedRows: 1,
              actualRows: 90,
              loops: 1,
              totalCost: 7,
              properties: [],
              children: [],
            },
            { operation: 'C', estimatedRows: 200, actualRows: 0, loops: 1, properties: [], children: [] },
          ],
        },
      ],
    );
    const [a, b, c] = plan.roots[0]!.children;
    expect(a!.warnings).toEqual([{ kind: 'misestimate', estimated: 50, actual: 5000 }]);
    expect(b!.warnings).toEqual([]);
    expect(c!.warnings).toEqual([{ kind: 'misestimate', estimated: 200, actual: 0 }]);
    // Los hijos cuestan más que el padre (redondeos del motor): el propio no baja de 0.
    expect(plan.roots[0]!.selfCost).toBe(0);
    expect(plan.roots[0]!.actualTimeMs).toBe(2);
    expect(nodes(plan).map((n) => n.id)).toEqual(['n0', 'n1', 'n2', 'n3']);
  });
});
