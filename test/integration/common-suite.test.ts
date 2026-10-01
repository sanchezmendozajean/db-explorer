import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { QueryEvent } from '@shared/query';
import type { TreeNodeRef } from '@shared/metadata';
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
        expect(next, `nivel ${depth}: ${children.map((ch) => ch.ref.kind + ':' + ch.label).join(', ')}`).toBeDefined();
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
      expect(of(queryId, 'statement-done')[0]).toMatchObject({ truncated: true, hasMore: true, rowCount: 500 });
      expect(await manager.fetchMore({ queryId, statementIndex: 0, count: 500 })).toEqual({ loaded: 500, hasMore: true });
      expect(await manager.fetchMore({ queryId, statementIndex: 0, count: null })).toEqual({ loaded: 200, hasMore: false });
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
      const done = of(queryId, 'statement-done');
      expect(done[1]).toMatchObject({ command: 'INSERT', affected: 1 });
      expect(done[2]).toMatchObject({ command: 'UPDATE', affected: 3 });
      expect(Number(rowsOf(queryId)[0]![0])).toBe(4);
      // En otra ejecución de la misma pestaña la transacción sigue abierta.
      const rollback = await exec([c.sql.rollback, `SELECT count(*) AS n FROM ${t}`]);
      expect(Number(rowsOf(rollback.queryId)[0]![0])).toBe(3);
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
