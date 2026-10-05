import type { Engine } from '@shared/connection';
import type { ExecutionPlan, PlanNode, PlanProperty, PlanPropertyGroup, PlanWarning } from '@shared/plan';
import { PLAN_LIMITS } from '@shared/plan';

/**
 * Nodo tal como lo arma el parser de un motor. `buildPlan` calcula lo
 * derivado (costo y tiempo propios, avisos comunes) y asigna los ids.
 */
export interface DraftNode {
  operation: string;
  object?: string;
  alias?: string;
  condition?: string;
  /** Costo acumulado del subárbol; sin valor, se suma el de los hijos. */
  totalCost?: number;
  estimatedRows?: number;
  actualRows?: number;
  loops?: number;
  /** Tiempo real incluyendo a los hijos (total de todos los bucles). */
  inclusiveTimeMs?: number;
  /** Tiempo real propio, cuando el motor lo informa así (MariaDB). */
  selfTimeMs?: number;
  /** Recorrido completo de una tabla real: filas que lee (estimadas). */
  fullScanRows?: number;
  /** Ordenamiento o hash que usó disco. */
  spill?: boolean;
  engineWarnings?: string[];
  properties: PlanProperty[];
  children: DraftNode[];
}

export interface PlanHead {
  engine: Engine;
  analyzed: boolean;
  statement: string;
  raw: string;
  rawLanguage: ExecutionPlan['rawLanguage'];
  planningMs?: number;
  executionMs?: number;
  totalCost?: number;
}

const sum = (values: (number | undefined)[]): number | undefined =>
  values.some((v) => v !== undefined) ? values.reduce<number>((a, v) => a + (v ?? 0), 0) : undefined;

/** Redondea a 3 decimales (los motores devuelven costos y tiempos con ruido de coma flotante). */
const round = (n: number): number => Math.round(n * 1000) / 1000;

function totalCostOf(node: DraftNode): number | undefined {
  return node.totalCost ?? sum(node.children.map(totalCostOf));
}

function inclusiveTimeOf(node: DraftNode): number | undefined {
  if (node.inclusiveTimeMs !== undefined) return node.inclusiveTimeMs;
  const children = sum(node.children.map(inclusiveTimeOf));
  if (node.selfTimeMs === undefined) return children;
  return node.selfTimeMs + (children ?? 0);
}

function warningsOf(node: DraftNode, analyzed: boolean): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  if (node.fullScanRows !== undefined && node.fullScanRows >= PLAN_LIMITS.fullScanRows) {
    warnings.push({ kind: 'fullScan', rows: Math.round(node.fullScanRows) });
  }
  if (analyzed && node.actualRows !== undefined && node.estimatedRows !== undefined) {
    // Se compara por bucle: los motores estiman las filas de una ejecución del nodo.
    const actual = Math.round(node.actualRows / Math.max(node.loops ?? 1, 1));
    const estimated = Math.round(node.estimatedRows);
    const high = Math.max(actual, estimated);
    const low = Math.min(actual, estimated);
    if (high > PLAN_LIMITS.misestimateMinRows && (low === 0 || high / low >= PLAN_LIMITS.misestimateFactor)) {
      warnings.push({ kind: 'misestimate', estimated, actual });
    }
  }
  if (node.spill) warnings.push({ kind: 'spill' });
  for (const message of node.engineWarnings ?? []) warnings.push({ kind: 'engine', message });
  return warnings;
}

/** Convierte los nodos del parser al modelo común (specs/12 §3). */
export function buildPlan(head: PlanHead, roots: DraftNode[]): ExecutionPlan {
  let next = 0;
  const convert = (node: DraftNode): PlanNode => {
    const id = `n${next++}`;
    const totalCost = totalCostOf(node);
    const childCosts = sum(node.children.map(totalCostOf));
    let actualTimeMs: number | undefined;
    if (head.analyzed) {
      if (node.selfTimeMs !== undefined) actualTimeMs = node.selfTimeMs;
      else {
        const inclusive = inclusiveTimeOf(node);
        const children = sum(node.children.map(inclusiveTimeOf)) ?? 0;
        if (inclusive !== undefined) actualTimeMs = Math.max(0, inclusive - children);
      }
    }
    return {
      id,
      operation: node.operation,
      object: node.object,
      alias: node.alias,
      condition: node.condition,
      totalCost: totalCost === undefined ? undefined : round(totalCost),
      selfCost: totalCost === undefined ? undefined : round(Math.max(0, totalCost - (childCosts ?? 0))),
      estimatedRows: node.estimatedRows,
      actualRows: head.analyzed && node.actualRows !== undefined ? Math.round(node.actualRows) : undefined,
      loops: head.analyzed ? node.loops : undefined,
      actualTimeMs: actualTimeMs === undefined ? undefined : round(actualTimeMs),
      warnings: warningsOf(node, head.analyzed),
      properties: node.properties,
      children: node.children.map(convert),
    };
  };
  const converted = roots.map(convert);
  const totalCost = head.totalCost ?? sum(converted.map((r) => r.totalCost));
  return {
    engine: head.engine,
    analyzed: head.analyzed,
    statement: head.statement,
    planningMs: head.planningMs === undefined ? undefined : round(head.planningMs),
    executionMs: head.executionMs === undefined ? undefined : round(head.executionMs),
    totalCost: totalCost === undefined ? undefined : round(totalCost),
    roots: converted,
    raw: head.raw,
    rawLanguage: head.rawLanguage,
  };
}

/** Texto de una propiedad del motor (listas separadas por comas, objetos como JSON). */
export function propertyText(value: unknown): string {
  if (Array.isArray(value)) return value.map(propertyText).join(', ');
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function property(group: PlanPropertyGroup, label: string, value: unknown): PlanProperty {
  return { group, label, value: propertyText(value) };
}

/** Número de una propiedad del motor (`undefined` si no es numérica). */
export function num(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
