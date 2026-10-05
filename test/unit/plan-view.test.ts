import { beforeAll, describe, expect, it } from 'vitest';
import type { ExecutionPlan } from '@shared/plan';
import { analyzeStatement } from '@shared/splitter';
import { formatXml, planIcon, planSummary, rowText } from '../../src/renderer/features/plan/plan-format';

beforeAll(() => {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = () => undefined;
});

const plan = (analyzed: boolean): ExecutionPlan => ({
  engine: 'postgres',
  analyzed,
  statement: 'select 1',
  totalCost: 247.6,
  planningMs: 0.4,
  executionMs: analyzed ? 12.3 : undefined,
  roots: [
    {
      id: 'n0',
      operation: 'Seq Scan',
      object: 'dbx.t',
      totalCost: 247.6,
      selfCost: 247.6,
      estimatedRows: 12345,
      warnings: [],
      properties: [],
      children: [],
    },
  ],
  raw: '[]',
  rawLanguage: 'json',
});

describe('presentación del plan', () => {
  it('ícono por familia, resumen y texto de la fila', () => {
    expect(planIcon('Hash Join')).toBe('merge');
    expect(planIcon('Hash Match (Aggregate)')).toBe('symbol-operator');
    expect(planIcon('Clustered Index Seek')).toBe('key');
    expect(planIcon('Seq Scan')).toBe('table');
    expect(planIcon('Sort')).toBe('list-ordered');
    expect(planIcon('Result')).toBe('circle-outline');
    expect(planSummary(plan(true))).toBe('Costo total 247,6 · Planificación 0,4 ms · Ejecución 12,3 ms');
    expect(rowText(plan(false).roots[0]!)).toBe('Seq Scan · dbx.t · 247,6 · 12.345');
  });

  it('sangra el XML de una sola línea', () => {
    expect(formatXml('<a x="1"><b/><c>texto</c></a>')).toBe('<a x="1">\n  <b/>\n  <c>texto</c>\n</a>');
    expect(formatXml('<a>\n</a>')).toBe('<a>\n</a>');
  });

  it('las sentencias de estructura no se pueden explicar y ejecutar', () => {
    expect(analyzeStatement('create table t (a int)').isStructure).toBe(true);
    expect(analyzeStatement('TRUNCATE t').isStructure).toBe(true);
    expect(analyzeStatement('delete from t where a = 1').isStructure).toBe(false);
  });
});

describe('results-store: pestaña Plan', () => {
  it('el plan convive con los resultados; un error conserva el anterior', async () => {
    const { applyQueryEvent, beginExecution, endExecution, tabResults, useResultsStore } =
      await import('../../src/renderer/features/results/results-store');
    const meta = { text: 'select 1', start: 0, startLine: 1, startColumn: 1 };
    beginExecution('p1', 'q1', [meta], { keepPrevious: false });
    applyQueryEvent({
      type: 'columns',
      queryId: 'q1',
      index: 0,
      columns: [{ name: 'a', nativeType: 'int', logicalType: 'integer' }],
    });
    endExecution('p1', 'q1');

    beginExecution('p1', 'q2', [meta], { keepPrevious: false, explain: true });
    expect(tabResults('p1')).toMatchObject({ planPending: true, activeView: 'plan' });
    expect(tabResults('p1').lastRun[0]?.text).toBe('select 1');
    const first = plan(false);
    applyQueryEvent({ type: 'plan', queryId: 'q2', index: 0, plan: first });
    endExecution('p1', 'q2');
    expect(tabResults('p1')).toMatchObject({ plan: first, planPending: false, activeView: 'plan' });
    expect(tabResults('p1').results).toHaveLength(1);

    // Falla el siguiente: se muestra Mensajes y la pestaña Plan conserva el anterior.
    beginExecution('p1', 'q3', [meta], { keepPrevious: false, explain: true });
    applyQueryEvent({
      type: 'statement-error',
      queryId: 'q3',
      index: 0,
      message: 'syntax error',
      cancelled: false,
      durationMs: 1,
    });
    endExecution('p1', 'q3');
    expect(tabResults('p1')).toMatchObject({ plan: first, planPending: false, activeView: 'messages' });

    // Una ejecución normal no quita el plan; cerrarlo vuelve al último resultado.
    beginExecution('p1', 'q4', [meta], { keepPrevious: false });
    expect(tabResults('p1').plan).toBe(first);
    useResultsStore.getState().setActiveView('p1', 'plan');
    useResultsStore.getState().closePlan('p1');
    expect(tabResults('p1').plan).toBeNull();
    expect(tabResults('p1').activeView).toBe('messages');
  });
});
