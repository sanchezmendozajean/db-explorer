import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { EditTable } from '@shared/data-edit';
import { buildStatements } from '@shared/data-edit';
import type { QueryEvent } from '@shared/query';
import type { TreeNodeRef } from '@shared/metadata';
import { walkPlan } from '@shared/plan';
import { ConnectionManager, defaultDriverFactory } from '../../src/db-host/connection-manager';
import type { EngineCase, TableRef } from './engines';
import { engineCases, runner } from './engines';

/**
 * Suite común de integración (specs/03 §Tests): las mismas pruebas contra los
 * cuatro motores. Los que no tienen servidor se saltan con el motivo; los de
 * solo lectura saltan las pruebas que escriben.
 */

const cases = await engineCases(inject('pg'));

describe.each(cases)('$label', (c: EngineCase) => {
  const events: QueryEvent[] = [];
  const manager = new ConnectionManager(defaultDriverFactory, (e) => events.push(e));
  const id = c.config.id;
  let table: TableRef;
  let n = 0;

  const of = <T extends QueryEvent['type']>(queryId: string, type: T): Extract<QueryEvent, { type: T }>[] =>
    events.filter((e): e is Extract<QueryEvent, { type: T }> => e.type === type && e.queryId === queryId);
  const rowsOf = (queryId: string): unknown[][] => of(queryId, 'rows').flatMap((e) => e.rows);

  async function exec(statements: string[], maxRows: number | null = 500, database?: string) {
    const queryId = `${id}-${n++}`;
    const summary = await manager.execute({
      queryId,
      sessionId: `tab-${id}`,
      connectionId: id,
      database: database ?? table?.database,
      schema: table?.schema,
      statements,
      maxRows,
    });
    return { queryId, summary };
  }

  beforeAll(async () => {
    if (c.skip) return;
    await manager.connect(c.config, c.password);
    table = await c.prepare(runner(manager, events, id));
  });

  afterAll(() => manager.disconnectAll());

  describe.skipIf(!!c.skip)(c.skip ? `(se salta: ${c.skip})` : 'pruebas', () => {
    it('conecta e informa el producto', async () => {
      const info = await manager.test(c.config, c.password);
      expect(info.product).toMatch(c.engine === 'sqlserver' ? /SQL Server|Azure SQL/ : /\w+ \d/);
      expect(info.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('navega el árbol hasta la tabla y sus columnas con la clave primaria', async () => {
      let level: TreeNodeRef = { kind: 'connection' };
      let found = false;
      for (let depth = 0; depth < 6 && !found; depth++) {
        const children = await manager.children(id, level);
        const next = children.find(
          (ch) =>
            (ch.ref.kind === 'database' && ch.ref.database === table.database) ||
            (ch.ref.kind === 'schema' && ch.ref.schema === table.schema) ||
            (ch.ref.kind === 'objectFolder' && ch.ref.objectKind === 'table') ||
            (ch.ref.kind === 'object' && ch.ref.name === table.name),
        );
        expect(
          next,
          `nivel ${depth}: ${children.map((ch) => ch.ref.kind + ':' + ch.label).join(', ')}`,
        ).toBeDefined();
        if (next!.ref.kind === 'objectFolder') expect(next!.count).toBeGreaterThan(0);
        level = next!.ref;
        found = level.kind === 'object';
      }
      const columns = await manager.children(id, level);
      const pk = columns.find((ch) => ch.ref.kind === 'column' && ch.label === table.pk);
      expect(pk?.primaryKey).toBe(true);
      expect(pk?.secondary).toMatch(/NOT NULL/);
      const indexFolder = columns.find((ch) => ch.ref.kind === 'indexFolder');
      expect(indexFolder?.count).toBeGreaterThan(0);
      const indexes = await manager.children(id, indexFolder!.ref);
      expect(indexes.some((i) => i.primaryKey)).toBe(true);
    });

    it('ejecuta un SELECT y describe la tabla de origen y la clave', async () => {
      const { queryId, summary } = await exec([`SELECT * FROM ${quoted(c, table)}`], 2);
      expect(summary).toMatchObject({ executed: 1, failed: false });
      const columns = of(queryId, 'columns')[0]!.columns;
      const pk = columns.find((col) => col.name === table.pk);
      expect(pk).toMatchObject({ sourceTable: table.name, isPk: true });
      expect(of(queryId, 'statement-done')[0]).toMatchObject({ command: 'SELECT' });
    });

    it('devuelve los tipos sin pérdida de precisión ni cambio de zona', async () => {
      const { queryId } = await exec([c.sql.literals]);
      expect(rowsOf(queryId)[0]).toEqual(c.sql.expected.values);
      expect(of(queryId, 'columns')[0]!.columns.map((col) => col.logicalType)).toEqual(c.sql.expected.types);
    });

    it('respeta el límite y "Cargar más" lee el resto en lotes', async () => {
      const { queryId } = await exec([c.sql.rows(1200)], 500);
      expect(rowsOf(queryId)).toHaveLength(500);
      expect(of(queryId, 'rows').every((e) => e.rows.length <= 500)).toBe(true);
      expect(of(queryId, 'statement-done')[0]).toMatchObject({
        truncated: true,
        hasMore: true,
        rowCount: 500,
      });
      expect(await manager.fetchMore({ queryId, statementIndex: 0, count: 500 })).toEqual({
        loaded: 500,
        hasMore: true,
      });
      expect(await manager.fetchMore({ queryId, statementIndex: 0, count: null })).toEqual({
        loaded: 200,
        hasMore: false,
      });
      const all = rowsOf(queryId).map((r) => Number(r[0]));
      expect(all).toHaveLength(1200);
      expect(all[1199]).toBe(1200);
      // La sesión sigue usable después del cursor.
      const after = await exec(['SELECT 1 AS x']);
      expect(rowsOf(after.queryId)).toEqual([[1]]);
    });

    it('informa errores con su posición dentro de la sentencia', async () => {
      const { queryId, summary } = await exec(['SELECT 1,\nFROM x']);
      expect(summary.failed).toBe(true);
      const [error] = of(queryId, 'statement-error');
      expect(error?.message).toBeTruthy();
      expect(error?.position).toBe(11);
    });

    it('cancela una consulta larga y la sesión sigue usable', async () => {
      const queryId = `${id}-cancel`;
      const running = manager.execute({
        queryId,
        sessionId: `tab-${id}`,
        connectionId: id,
        database: table.database,
        statements: [c.sql.sleep],
        maxRows: null,
      });
      await new Promise((r) => setTimeout(r, 800));
      const started = Date.now();
      await manager.queries.cancel(queryId);
      const summary = await running;
      expect(summary).toMatchObject({ cancelled: true, failed: true });
      expect(Date.now() - started).toBeLessThan(10_000);
      const after = await exec(['SELECT 2 AS x']);
      expect(rowsOf(after.queryId)).toEqual([[2]]);
    });

    it.runIf(!!c.sql.message)('entrega los mensajes del servidor', async () => {
      const { queryId } = await exec([c.sql.message!.sql]);
      const messages = of(queryId, 'message').map((m) => m.text);
      expect(messages.join('\n')).toMatch(c.sql.message!.text);
    });

    it.runIf(!!c.sql.multipleResults)('una sentencia con varios resultados los entrega todos', async () => {
      const { queryId } = await exec([c.sql.multipleResults!]);
      const sets = of(queryId, 'columns');
      expect(sets.map((s) => s.columns.map((col) => col.name))).toEqual([['a'], ['b', 'c']]);
      expect(rowsOf(queryId)).toEqual([[1], [2, 3]]);
    });

    it.runIf(c.writable)('DML informa filas afectadas y la sesión conserva la transacción', async () => {
      const t = quoted(c, table);
      const { queryId } = await exec([
        c.sql.begin,
        `INSERT INTO ${t} (id, nombre) VALUES (100, 'temporal')`,
        `UPDATE ${t} SET nombre = 'x' WHERE id >= 2`,
        `SELECT count(*) AS n FROM ${t}`,
      ]);
      expect(of(queryId, 'statement-error').map((e) => e.message)).toEqual([]);
      const done = of(queryId, 'statement-done');
      expect(done[1]).toMatchObject({ command: 'INSERT', affected: 1 });
      expect(done[2]).toMatchObject({ command: 'UPDATE', affected: 3 });
      expect(Number(rowsOf(queryId)[0]![0])).toBe(4);
      // En otra ejecución de la misma pestaña la transacción sigue abierta.
      const rollback = await exec([c.sql.rollback, `SELECT count(*) AS n FROM ${t}`]);
      expect(Number(rowsOf(rollback.queryId)[0]![0])).toBe(3);
    });

    it('describe restricciones, índices y DDL de la tabla', async () => {
      const ref = { database: table.database, schema: table.schema, name: table.name };
      const details = await manager.tableDetails(id, ref, 'table');
      expect(details.columns.map((col) => col.name)).toContain(table.pk);
      const pk = details.constraints.find((k) => k.type === 'primaryKey');
      expect(pk?.columns).toEqual([table.pk]);
      expect(details.indexes.some((i) => i.primary)).toBe(true);
      if (c.writable) {
        const ddl = await manager.ddl(id, ref, 'table');
        expect(ddl).toMatch(/CREATE TABLE/i);
        expect(ddl).toMatch(/clientes/);
        expect(ddl).toMatch(/idx_clientes_nombre/);
      }
    });

    /** Filas de `clientes` vistas desde otra sesión (lo confirmado). */
    async function committedIds(): Promise<number[]> {
      const queryId = `${id}-${n++}`;
      await manager.execute({
        queryId,
        sessionId: `otra-${id}`,
        connectionId: id,
        database: table.database,
        schema: table.schema,
        statements: [
          // SQL Server bloquearía la lectura de filas con cambios sin confirmar.
          ...(c.engine === 'sqlserver' ? ['SET TRANSACTION ISOLATION LEVEL SNAPSHOT'] : []),
          `SELECT id FROM ${quoted(c, table)} ORDER BY id`,
        ],
        maxRows: null,
      });
      return rowsOf(queryId).map((r) => Number(r[0]));
    }

    async function execManual(statements: string[]) {
      const queryId = `${id}-${n++}`;
      const summary = await manager.execute({
        queryId,
        sessionId: `tab-${id}`,
        connectionId: id,
        database: table.database,
        schema: table.schema,
        statements,
        maxRows: 500,
        autoCommit: false,
      });
      expect(of(queryId, 'statement-error').map((e) => e.message)).toEqual([]);
      return summary;
    }

    it.runIf(c.writable)('modo manual: Rollback descarta y Commit confirma', async () => {
      const t = quoted(c, table);
      await execManual([`INSERT INTO ${t} (id, nombre) VALUES (200, 'manual')`]);
      expect(await committedIds()).not.toContain(200);
      await manager.queries.endTransaction(`tab-${id}`, false);
      await execManual([`INSERT INTO ${t} (id, nombre) VALUES (201, 'manual')`]);
      await manager.queries.endTransaction(`tab-${id}`, true);
      const ids = await committedIds();
      expect(ids).not.toContain(200);
      expect(ids).toContain(201);
      // Volver a auto-commit; limpieza.
      await exec([`DELETE FROM ${t} WHERE id = 201`]);
      expect(await committedIds()).toEqual([1, 2, 3]);
    });

    const editTable = (): EditTable => ({
      engine: c.engine,
      schema: c.engine === 'sqlite' ? undefined : table.schema,
      name: table.name,
      columns: [
        { name: 'id', type: 'integer' },
        { name: 'nombre', type: 'text' },
        { name: 'importe', type: 'decimal' },
      ],
      keyColumns: [0],
    });

    const target = (autoCommit = true) => ({
      sessionId: `tab-${id}`,
      connectionId: id,
      database: table.database,
      schema: table.schema,
      autoCommit,
    });

    it.runIf(c.writable)('guarda ediciones, inserciones y eliminaciones en una transacción', async () => {
      const generated = buildStatements(editTable(), [
        { kind: 'delete', key: [3] },
        // Mismo valor que ya tenía: debe contar como una fila (MariaDB informa filas encontradas).
        { kind: 'update', key: [1], changes: [{ column: 1, value: 'Ana' }] },
        {
          kind: 'update',
          key: [2],
          changes: [
            { column: 2, value: '99.95' },
            { column: 1, value: "O'Neil" },
          ],
        },
        {
          kind: 'insert',
          values: [
            { column: 0, value: 300 },
            { column: 1, value: 'nuevo ñ' },
          ],
        },
      ]);
      const result = await manager.apply({ ...target(), statements: generated.map((g) => g.statement) });
      expect(result).toEqual({ ok: true, affected: [1, 1, 1, 1] });
      const { queryId } = await exec([`SELECT id, nombre, importe FROM ${quoted(c, table)} ORDER BY id`]);
      expect(rowsOf(queryId).map((r) => [Number(r[0]), r[1], r[2] === null ? null : Number(r[2])])).toEqual([
        [1, 'Ana', 10.5],
        [2, "O'Neil", 99.95],
        [300, 'nuevo ñ', null],
      ]);

      // Una clave que no existe revierte todo, incluida la inserción anterior.
      const failing = buildStatements(editTable(), [
        {
          kind: 'insert',
          values: [
            { column: 0, value: 400 },
            { column: 1, value: 'no queda' },
          ],
        },
        { kind: 'update', key: [999], changes: [{ column: 1, value: 'x' }] },
      ]);
      const bad = await manager.apply({ ...target(), statements: failing.map((g) => g.statement) });
      expect(bad).toMatchObject({ ok: false, index: 1 });
      expect(await committedIds()).toEqual([1, 2, 300]);

      // Un error del motor también revierte (clave duplicada).
      const duplicate = buildStatements(editTable(), [
        { kind: 'update', key: [2], changes: [{ column: 1, value: 'tampoco' }] },
        {
          kind: 'insert',
          values: [
            { column: 0, value: 1 },
            { column: 1, value: 'dup' },
          ],
        },
      ]);
      const dup = await manager.apply({ ...target(), statements: duplicate.map((g) => g.statement) });
      expect(dup).toMatchObject({ ok: false, index: 1 });
      const after = await exec([`SELECT nombre FROM ${quoted(c, table)} WHERE id = 2`]);
      expect(rowsOf(after.queryId)).toEqual([["O'Neil"]]);

      // En modo manual queda pendiente hasta Commit/Rollback.
      const manual = buildStatements(editTable(), [{ kind: 'delete', key: [300] }]);
      expect(await manager.apply({ ...target(false), statements: manual.map((g) => g.statement) })).toEqual({
        ok: true,
        affected: [1],
      });
      expect(await committedIds()).toEqual([1, 2, 300]);
      await manager.queries.endTransaction(`tab-${id}`, false);
      expect(await committedIds()).toEqual([1, 2, 300]);

      // Restaura los datos de la suite.
      await c.prepare(runner(manager, events, id));
    });

    it('exporta a CSV re-ejecutando la consulta sin límite', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'dbx-export-'));
      const path = join(dir, 'clientes.csv');
      const columns = [
        { name: 'nombre', nativeType: '', logicalType: 'text' as const },
        { name: 'id', nativeType: '', logicalType: 'integer' as const },
      ];
      const summary = await manager.export({
        exportId: `${id}-export`,
        path,
        format: 'csv',
        options: { separator: ';', header: true, bom: false, table: '' },
        columns,
        source: {
          kind: 'query',
          ...target(),
          sql: `SELECT id, nombre FROM ${quoted(c, table)} ORDER BY id`,
          columnIndexes: [1, 0],
        },
      });
      expect(summary).toEqual({ rows: 3, cancelled: false });
      expect(readFileSync(path, 'utf8')).toBe('nombre;id\r\nAna;1\r\nBeto;2\r\nÑandú 🦆;3\r\n');
    });

    describe.runIf(c.writable)('plan de ejecución (specs/12)', () => {
      const p = c.plan.prefix;
      const joinSql = `SELECT plan_clientes.nombre, sum(plan_pedidos.total) AS total
        FROM ${p}plan_pedidos JOIN ${p}plan_clientes ON plan_clientes.id = plan_pedidos.cliente_id
        WHERE plan_pedidos.total > 10 GROUP BY plan_clientes.nombre`;

      beforeAll(async () => {
        await exec(c.plan.setup, null);
      });

      async function explain(
        sql: string,
        analyze: boolean,
        options: { write?: boolean; autoCommit?: boolean } = {},
      ) {
        const queryId = `${id}-${n++}`;
        const summary = await manager.execute({
          queryId,
          sessionId: `tab-${id}`,
          connectionId: id,
          database: table.database,
          schema: table.schema,
          statements: [sql],
          maxRows: 500,
          autoCommit: options.autoCommit,
          explain: { analyze, write: options.write ?? false },
        });
        const error = of(queryId, 'statement-error')[0];
        return { summary, plan: of(queryId, 'plan')[0]?.plan, error };
      }

      async function pedidos(): Promise<number> {
        const { queryId } = await exec([`SELECT count(*) FROM ${p}plan_pedidos`]);
        return Number(rowsOf(queryId)[0]![0]);
      }

      it('explica un JOIN: árbol con la tabla de cada lado, costos y aviso de recorrido completo', async () => {
        const { plan, error } = await explain(joinSql, false);
        expect(error?.message).toBeUndefined();
        expect(plan).toBeDefined();
        const nodes = [...walkPlan(plan!.roots)];
        const objects = nodes.map((node) => node.object ?? node.operation).join(' | ');
        expect(objects).toMatch(/plan_pedidos/);
        expect(objects).toMatch(/plan_clientes/);
        expect(plan!.analyzed).toBe(false);
        if (c.engine === 'sqlite') {
          expect(plan!.totalCost).toBeUndefined();
          return;
        }
        expect(plan!.totalCost).toBeGreaterThan(0);
        const fullScans = nodes.flatMap((node) => node.warnings).filter((w) => w.kind === 'fullScan');
        expect(fullScans.length).toBeGreaterThan(0);
        expect(fullScans.every((w) => w.kind === 'fullScan' && w.rows >= 10_000)).toBe(true);
      });

      it('explicar y ejecutar un DELETE muestra filas reales y la tabla conserva sus filas', async () => {
        const { plan, error, summary } = await explain(`DELETE FROM ${p}plan_pedidos WHERE id <= 500`, true, {
          write: true,
        });
        if (c.engine === 'sqlite') {
          expect(summary.failed).toBe(true);
          expect(error?.message).toMatch(/SQLite no informa filas ni tiempos reales/);
          return;
        }
        expect(error?.message).toBeUndefined();
        expect(plan!.analyzed).toBe(true);
        const nodes = [...walkPlan(plan!.roots)];
        expect(nodes.some((node) => (node.actualRows ?? 0) >= 500)).toBe(true);
        expect(await pedidos()).toBe(20_000);
      });

      it.runIf(c.engine !== 'sqlite')(
        'en modo manual mide dentro de un punto de guardado y la transacción sigue abierta',
        async () => {
          await execManual([`DELETE FROM ${p}plan_pedidos WHERE id = 20000`]);
          const { error } = await explain(`DELETE FROM ${p}plan_pedidos WHERE id <= 100`, true, {
            write: true,
            autoCommit: false,
          });
          expect(error?.message).toBeUndefined();
          // El DELETE previo sigue pendiente y Rollback lo revierte.
          await manager.queries.endTransaction(`tab-${id}`, false);
          await exec(['SELECT 1']);
          expect(await pedidos()).toBe(20_000);
        },
      );

      it.runIf(c.engine === 'mariadb')(
        'no mide escrituras sobre tablas que no admiten transacciones',
        async () => {
          await exec(['DROP TABLE IF EXISTS plan_myisam', 'CREATE TABLE plan_myisam (id int) ENGINE=MyISAM']);
          await exec(['INSERT INTO plan_myisam VALUES (1), (2)']);
          const { error } = await explain('DELETE FROM plan_myisam WHERE id = 1', true, { write: true });
          expect(error?.message).toBe(
            'La tabla plan_myisam no admite transacciones; no se puede ejecutar y revertir',
          );
          const { queryId } = await exec(['SELECT count(*) FROM plan_myisam']);
          expect(Number(rowsOf(queryId)[0]![0])).toBe(2);
          await exec(['DROP TABLE plan_myisam']);
        },
      );
    });
  });
});

function quoted(c: EngineCase, t: TableRef): string {
  switch (c.engine) {
    case 'sqlite':
      return `"${t.name}"`;
    case 'mariadb':
      return `\`${t.database}\`.\`${t.name}\``;
    case 'sqlserver':
      return `[${t.schema}].[${t.name}]`;
    default:
      return `"${t.schema}"."${t.name}"`;
  }
}
