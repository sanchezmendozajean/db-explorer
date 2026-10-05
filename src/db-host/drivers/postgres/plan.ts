import type { ExecutionPlan, PlanProperty, PlanPropertyGroup } from '@shared/plan';
import type { DraftNode } from '../plan-builder';
import { buildPlan, num, property } from '../plan-builder';

/** Nodo de `EXPLAIN (FORMAT JSON)`. */
type PgNode = Record<string, unknown> & { Plans?: PgNode[] };

const ESTIMATED = new Set(['Startup Cost', 'Total Cost', 'Plan Rows', 'Plan Width']);
const ACTUAL_PREFIXES = [
  'Actual ',
  'Rows Removed',
  'Shared ',
  'Local ',
  'Temp ',
  'I/O ',
  'WAL ',
  'Peak Memory',
  'Sort Method',
  'Sort Space',
  'Heap Fetches',
  'Exact Heap',
  'Lossy Heap',
  'Hash Batches',
  'Hash Buckets',
  'Original Hash',
  'HashAgg Batches',
  'Disk Usage',
  'Index Searches',
  'Workers Launched',
  'Workers',
];
/** Datos que ya se muestran en columnas o no aportan al detalle. */
const SKIPPED = new Set(['Plans', 'Node Type', 'Parallel Aware', 'Async Capable', 'Disabled']);

/** Condiciones en orden de preferencia para la segunda línea del nodo. */
const CONDITIONS = [
  'Hash Cond',
  'Merge Cond',
  'Index Cond',
  'Recheck Cond',
  'Join Filter',
  'Filter',
  'One-Time Filter',
  'TID Cond',
];

const JOINS = new Set(['Hash Join', 'Merge Join', 'Nested Loop']);
const AGGREGATE_NAMES: Record<string, string> = {
  Hashed: 'HashAggregate',
  Sorted: 'GroupAggregate',
  Mixed: 'MixedAggregate',
};

function groupOf(key: string): PlanPropertyGroup {
  if (ESTIMATED.has(key)) return 'estimated';
  return ACTUAL_PREFIXES.some((p) => key.startsWith(p)) ? 'actual' : 'general';
}

/** Nombre de la operación como en la salida de texto de PostgreSQL ("Hash Left Join", "HashAggregate"…). */
function operationOf(node: PgNode): string {
  const type = String(node['Node Type']);
  let name = type;
  if (type === 'Aggregate') name = AGGREGATE_NAMES[String(node['Strategy'])] ?? type;
  else if (type === 'ModifyTable' && node['Operation']) name = String(node['Operation']);
  else if (JOINS.has(type) && node['Join Type'] && node['Join Type'] !== 'Inner') {
    const join = String(node['Join Type']);
    name = type === 'Nested Loop' ? `${type} ${join} Join` : type.replace(' Join', ` ${join} Join`);
  }
  return node['Parallel Aware'] === true ? `Parallel ${name}` : name;
}

function objectOf(node: PgNode): { object?: string; alias?: string } {
  const relation = node['Relation Name'] as string | undefined;
  if (relation) {
    const schema = node['Schema'] as string | undefined;
    const alias = node['Alias'] as string | undefined;
    return {
      object: schema ? `${schema}.${relation}` : relation,
      alias: alias !== relation ? alias : undefined,
    };
  }
  const other = node['Index Name'] ?? node['CTE Name'] ?? node['Function Name'] ?? node['Alias'];
  return { object: other === undefined ? undefined : String(other) };
}

/** Filas de una tabla por "esquema.tabla" (estadísticas del catálogo), para el aviso de recorrido completo. */
export type TableRows = ReadonlyMap<string, number>;

/** Tablas recorridas con Seq Scan (para pedir sus filas al catálogo). */
export function seqScanTables(raw: string): { schema: string; name: string }[] {
  const out: { schema: string; name: string }[] = [];
  const visit = (node: PgNode): void => {
    if (String(node['Node Type']) === 'Seq Scan' && node['Relation Name'] && node['Schema']) {
      out.push({ schema: String(node['Schema']), name: String(node['Relation Name']) });
    }
    node.Plans?.forEach(visit);
  };
  for (const entry of JSON.parse(raw) as { Plan: PgNode }[]) visit(entry.Plan);
  return out;
}

function draft(node: PgNode, tableRows: TableRows): DraftNode {
  const loops = num(node['Actual Loops']);
  const perLoopRows = num(node['Actual Rows']);
  const perLoopTime = num(node['Actual Total Time']);
  const properties: PlanProperty[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (!SKIPPED.has(key)) properties.push(property(groupOf(key), key, value));
  }
  const condition = CONDITIONS.map((k) => node[k]).find((v) => v !== undefined);
  const type = String(node['Node Type']);
  const schema = node['Schema'] as string | undefined;
  let fullScanRows: number | undefined;
  if (type === 'Seq Scan' && !schema?.startsWith('pg_temp')) {
    const known = tableRows.get(`${schema}.${String(node['Relation Name'])}`);
    const removed = num(node['Rows Removed by Filter']) ?? 0;
    fullScanRows =
      known !== undefined && known >= 0
        ? known
        : perLoopRows !== undefined
          ? perLoopRows + removed
          : num(node['Plan Rows']);
  }
  const spill =
    node['Sort Space Type'] === 'Disk' ||
    String(node['Sort Method'] ?? '').startsWith('external') ||
    (num(node['Hash Batches']) ?? 0) > 1 ||
    (num(node['Disk Usage']) ?? 0) > 0;
  return {
    operation: operationOf(node),
    ...objectOf(node),
    condition: condition === undefined ? undefined : String(condition),
    totalCost: num(node['Total Cost']),
    estimatedRows: num(node['Plan Rows']),
    actualRows: perLoopRows !== undefined && loops !== undefined ? perLoopRows * loops : undefined,
    loops,
    inclusiveTimeMs: perLoopTime !== undefined && loops !== undefined ? perLoopTime * loops : undefined,
    fullScanRows,
    spill,
    properties,
    children: (node.Plans ?? []).map((child) => draft(child, tableRows)),
  };
}

/** `EXPLAIN (FORMAT JSON, VERBOSE[, ANALYZE, BUFFERS])` → modelo común. */
export function parsePostgresPlan(
  raw: string,
  statement: string,
  analyzed: boolean,
  tableRows: TableRows = new Map(),
): ExecutionPlan {
  const [entry] = JSON.parse(raw) as (Record<string, unknown> & { Plan: PgNode })[];
  if (!entry) throw new Error('El motor no devolvió un plan');
  return buildPlan(
    {
      engine: 'postgres',
      analyzed,
      statement,
      raw,
      rawLanguage: 'json',
      planningMs: num(entry['Planning Time']),
      executionMs: num(entry['Execution Time']),
    },
    [draft(entry.Plan, tableRows)],
  );
}
