import { describe, expect, it } from 'vitest';
import { walkPlan } from '@shared/plan';
import { parseSqlServerPlan } from '../../src/db-host/drivers/sqlserver/plan';
import { ancestorsOf, nodesWithWarnings } from '../../src/renderer/features/plan/plan-format';

/**
 * Planes de SQL Server grandes, generados (los reales que se probaron eran pequeños): un árbol de
 * uniones anidadas muy ancho y una cadena profunda (300 operadores: el parser de XML cortaba a las 100 etiquetas anidadas, unos 30 operadores).
 */

const HEAD =
  '<ShowPlanXML xmlns="http://schemas.microsoft.com/sqlserver/2004/07/showplan" Version="1.539"><BatchSequence><Batch><Statements>' +
  '<StmtSimple StatementText="SELECT …" StatementId="1" StatementType="SELECT" StatementSubTreeCost="1" StatementEstRows="10"><QueryPlan>';
const TAIL = '</QueryPlan></StmtSimple></Statements></Batch></BatchSequence></ShowPlanXML>';

let id = 0;
const relOp = (op: string, inner: string): string =>
  `<RelOp NodeId="${id++}" PhysicalOp="${op}" LogicalOp="${op}" EstimateRows="10" EstimateIO="0.01" EstimateCPU="0.001" ` +
  `AvgRowSize="10" EstimatedTotalSubtreeCost="1" Parallel="0" EstimateRebinds="0" EstimateRewinds="0" EstimatedExecutionMode="Row">${inner}</RelOp>`;

/** Árbol binario de Nested Loops con `depth` niveles y hojas que son búsquedas de índice. */
function wide(depth: number): string {
  if (depth === 0) {
    return relOp(
      'Index Seek',
      '<IndexScan Ordered="1"><Object Database="[d]" Schema="[s]" Table="[t]" Index="[ix]" IndexKind="NonClustered"/></IndexScan>',
    );
  }
  return relOp('Nested Loops', `<NestedLoops>${wide(depth - 1)}${wide(depth - 1)}</NestedLoops>`);
}

/** Cadena de `length` operadores Sort anidados. */
function deep(length: number): string {
  let xml = relOp('Table Scan', '<TableScan><Object Database="[d]" Schema="[s]" Table="[t]"/></TableScan>');
  for (let i = 0; i < length; i++) xml = relOp('Sort', `<Sort Distinct="0">${xml}</Sort>`);
  return xml;
}

describe('planes de SQL Server grandes', () => {
  it('un árbol ancho de ~8 000 nodos se interpreta rápido y completo', () => {
    id = 0;
    const xml = HEAD + wide(12) + TAIL;
    const started = performance.now();
    const plan = parseSqlServerPlan([xml], 'SELECT …', false);
    const elapsed = performance.now() - started;
    const nodes = [...walkPlan(plan.roots)];
    expect(nodes).toHaveLength(2 ** 13 - 1);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
    expect(elapsed).toBeLessThan(5000);
  });

  it('una cadena de 300 operadores anidados no desborda la pila', () => {
    id = 0;
    const plan = parseSqlServerPlan([HEAD + deep(300) + TAIL], 'SELECT …', false);
    const nodes = [...walkPlan(plan.roots)];
    expect(nodes).toHaveLength(301);
    const leaf = nodes[nodes.length - 1]!;
    expect(ancestorsOf(plan, leaf.id)).toHaveLength(300);
    expect(nodesWithWarnings(plan).length).toBeGreaterThanOrEqual(0);
  });
});
