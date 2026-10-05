/**
 * Modelo común del plan de ejecución (specs/12 §3): los parsers de cada
 * motor lo producen en el db-host y la pestaña Plan lo muestra.
 */

import type { Engine } from './connection';

export interface ExecutionPlan {
  engine: Engine;
  /** true = valores reales (Explicar y ejecutar). */
  analyzed: boolean;
  /** La sentencia explicada. */
  statement: string;
  planningMs?: number;
  executionMs?: number;
  /** Costo del nodo raíz (unidades del motor). */
  totalCost?: number;
  /** Normalmente uno; SQL Server y SQLite pueden devolver varios. */
  roots: PlanNode[];
  /** Respuesta original del motor (Ver original). */
  raw: string;
  rawLanguage: 'json' | 'xml' | 'plaintext';
}

/** Grupo del panel de detalle en el que se muestra una propiedad. */
export type PlanPropertyGroup = 'general' | 'estimated' | 'actual';

export interface PlanProperty {
  group: PlanPropertyGroup;
  label: string;
  value: string;
}

export interface PlanNode {
  id: string;
  /** "Seq Scan", "Hash Join", "Clustered Index Seek"… */
  operation: string;
  /** Tabla o índice. */
  object?: string;
  /** Alias de la tabla en la consulta, si difiere del nombre. */
  alias?: string;
  /** Filtro, condición de join o de índice (una línea). */
  condition?: string;
  /** Costo acumulado del subárbol. */
  totalCost?: number;
  /** Costo propio = total − suma de los hijos. */
  selfCost?: number;
  estimatedRows?: number;
  /** Total real (por bucle × bucles). */
  actualRows?: number;
  loops?: number;
  /** Tiempo propio en ms (sin el de los hijos). */
  actualTimeMs?: number;
  warnings: PlanWarning[];
  /** Todo lo demás que informó el motor, para el panel de detalle. */
  properties: PlanProperty[];
  children: PlanNode[];
}

export type PlanWarning =
  | { kind: 'fullScan'; rows: number }
  | { kind: 'misestimate'; estimated: number; actual: number }
  /** Ordenamiento o hash que usó disco. */
  | { kind: 'spill' }
  /** Avisos propios del motor (índice faltante, conversión implícita…). */
  | { kind: 'engine'; message: string };

/** Umbrales fijos de los avisos (specs/12 §3). */
export const PLAN_LIMITS = {
  /** Filas estimadas desde las que un recorrido completo se marca. */
  fullScanRows: 10_000,
  /** Factor entre filas reales y estimadas para marcar una estimación errada. */
  misestimateFactor: 10,
  /** Alguna de las dos cifras debe superar este valor. */
  misestimateMinRows: 100,
} as const;

/** Recorre los nodos en profundidad (orden de la vista). */
export function* walkPlan(nodes: readonly PlanNode[]): Generator<PlanNode> {
  for (const node of nodes) {
    yield node;
    yield* walkPlan(node.children);
  }
}
