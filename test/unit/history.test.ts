import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecuteRequest } from '@shared/query';
import { HistoryService } from '../../src/main/services/history-service';

const dirs: string[] = [];
const services: HistoryService[] = [];
afterEach(() => {
  for (const s of services.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(options: { enabled?: boolean; maxEntries?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dbx-hist-'));
  dirs.push(dir);
  const service = new HistoryService(join(dir, 'history.sqlite'), {
    enabled: () => options.enabled ?? true,
    maxEntries: () => options.maxEntries ?? 5000,
    connection: () => ({ name: 'PG Local', engine: 'postgres' }),
  });
  services.push(service);
  return service;
}

function run(service: HistoryService, queryId: string, statements: string[], fail?: number): void {
  const request: ExecuteRequest = { queryId, sessionId: 's', connectionId: 'c1', statements, maxRows: 500 };
  service.begin(request);
  statements.forEach((_, index) => {
    service.onEvent({ type: 'statement-start', queryId, index, startedAt: 1000 + index });
    if (index === fail) {
      service.onEvent({
        type: 'statement-error',
        queryId,
        index,
        message: 'boom',
        cancelled: false,
        durationMs: 3,
      });
    } else {
      service.onEvent({
        type: 'statement-done',
        queryId,
        index,
        command: 'SELECT',
        rowCount: 2,
        truncated: false,
        hasMore: false,
        durationMs: 5,
      });
    }
  });
  service.onEvent({
    type: 'execution-done',
    queryId,
    summary: {
      queryId,
      executed: statements.length,
      failed: fail !== undefined,
      cancelled: false,
      durationMs: 9,
    },
  });
}

describe('historial de consultas', () => {
  it('registra cada sentencia con duración, filas y error, la más reciente primero', () => {
    const h = setup();
    run(h, 'q1', ['select 1', 'select x'], 1);
    const list = h.list({});
    expect(list.map((e) => [e.sql, e.ok, e.rows, e.error])).toEqual([
      ['select x', false, undefined, 'boom'],
      ['select 1', true, 2, undefined],
    ]);
    expect(list[1]).toMatchObject({
      connectionName: 'PG Local',
      engine: 'postgres',
      durationMs: 5,
      at: 1000,
    });
  });

  it('filtra por texto (sin comodines del usuario) y por conexión', () => {
    const h = setup();
    run(h, 'q1', ['select * from clientes', 'select 100%']);
    expect(h.list({ text: 'clientes' }).map((e) => e.sql)).toEqual(['select * from clientes']);
    expect(h.list({ text: '%' }).map((e) => e.sql)).toEqual(['select 100%']);
    expect(h.list({ connectionId: 'otra' })).toEqual([]);
  });

  it('no registra nada con history.enabled en falso', () => {
    const h = setup({ enabled: false });
    run(h, 'q1', ['select 1']);
    expect(h.list({})).toEqual([]);
  });

  it('borra entradas y recorta a maxEntries', () => {
    const h = setup({ maxEntries: 100 });
    for (let i = 0; i < 160; i++) run(h, `q${i}`, [`select ${i}`]);
    // Se recorta cada 50 inserciones: quedan como mucho 100 + 49.
    expect(h.list({ limit: 5000 }).length).toBeLessThanOrEqual(149);
    const [first] = h.list({});
    h.remove(first!.id);
    expect(h.list({}).some((e) => e.id === first!.id)).toBe(false);
    h.clear();
    expect(h.list({})).toEqual([]);
  });
});
