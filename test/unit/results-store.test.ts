import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  // El store agrupa las filas por cuadro de animación; en Node se publica de inmediato.
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = () => undefined;
});

describe('results-store: varios resultados en una sentencia', () => {
  it('crea un resultado por cada conjunto y las filas van al último', async () => {
    const { applyQueryEvent, beginExecution, tabResults } =
      await import('../../src/renderer/features/results/results-store');
    const meta = { text: 'exec p', start: 0, startLine: 1, startColumn: 1 };
    beginExecution('t1', 'q1', [meta], { keepPrevious: false });
    const col = (name: string) => ({ name, nativeType: 'int', logicalType: 'integer' as const });
    applyQueryEvent({ type: 'columns', queryId: 'q1', index: 0, columns: [col('a')] });
    applyQueryEvent({ type: 'rows', queryId: 'q1', index: 0, rows: [[1]] });
    applyQueryEvent({ type: 'columns', queryId: 'q1', index: 0, columns: [col('b')] });
    applyQueryEvent({ type: 'rows', queryId: 'q1', index: 0, rows: [[2], [3]] });
    applyQueryEvent({
      type: 'statement-done',
      queryId: 'q1',
      index: 0,
      command: 'EXEC',
      rowCount: 3,
      truncated: true,
      hasMore: true,
      durationMs: 5,
    });
    const results = tabResults('t1').results;
    expect(results.map((r) => r.id)).toEqual(['q1:0', 'q1:0:1']);
    expect(results.map((r) => r.rows)).toEqual([[[1]], [[2], [3]]]);
    expect(results.map((r) => [r.done, r.hasMore])).toEqual([
      [true, false],
      [true, true],
    ]);
    expect(tabResults('t1').activeView).toBe('q1:0');
  });
});
