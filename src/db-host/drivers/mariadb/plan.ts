import type { ExecutionPlan, PlanProperty } from '@shared/plan';
import { PLAN_LIMITS } from '@shared/plan';
import type { DraftNode } from '../plan-builder';
import { buildPlan, num, property } from '../plan-builder';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Operación según el `access_type` de MariaDB. */
const ACCESS: Record<string, string> = {
  ALL: 'Table scan',
  index: 'Full index scan',
  range: 'Index range scan',
  ref: 'Index lookup',
  eq_ref: 'Unique index lookup',
  ref_or_null: 'Index lookup or null',
  index_merge: 'Index merge',
  const: 'Const row',
  system: 'Const row',
  fulltext: 'Fulltext search',
  hash_ALL: 'Hash join scan',
  hash_index: 'Hash join index',
  hash_range: 'Hash join range',
};

/** Nombres de los nodos contenedores de `EXPLAIN FORMAT=JSON`. */
const LABELS: Record<string, string> = {
  filesort: 'Filesort',
  temporary_table: 'Temporary table',
  nested_loop: 'Nested loop',
  read_sorted_file: 'Read sorted file',
  duplicates_removal: 'Duplicates removal',
  union_result: 'Union',
  query_specifications: 'Union parts',
  subqueries: 'Subqueries',
  materialized: 'Materialized',
  expression_cache: 'Expression cache',
  window_functions_computation: 'Window functions',
  'block-nl-join': 'Block nested loop',
};

/** Objetos que son estadísticas del nodo, no operaciones hijas. */
const STATS = new Set(['r_engine_stats', 'query_optimization', 'cost_info']);

/**
 * Costo propio de una tabla: `cost` en MariaDB; en el JSON (versión 1) de
 * MySQL, lectura + evaluación de `cost_info` (`prefix_cost` acumula el orden
 * del join, no el subárbol).
 */
function tableCost(t: Json): number | undefined {
  const own = num(t['cost']);
  if (own !== undefined) return own;
  const info = isObject(t['cost_info']) ? t['cost_info'] : undefined;
  const read = num(info?.['read_cost']);
  const evaluate = num(info?.['eval_cost']);
  return read === undefined && evaluate === undefined ? undefined : (read ?? 0) + (evaluate ?? 0);
}

/** Filas que lee la tabla por bucle: `rows` en MariaDB, `rows_examined_per_scan` en MySQL. */
const tableRows = (t: Json): number | undefined => num(t['rows']) ?? num(t['rows_examined_per_scan']);

const ESTIMATED_KEYS = new Set(['rows', 'cost', 'filtered', 'loops', 'select_id']);

function propertiesOf(obj: Json, skip: Set<string>): PlanProperty[] {
  const props: PlanProperty[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (skip.has(key)) continue;
    if ((isObject(value) && !STATS.has(key)) || (Array.isArray(value) && value.some(isObject))) continue;
    const group = key.startsWith('r_') ? 'actual' : ESTIMATED_KEYS.has(key) ? 'estimated' : 'general';
    props.push(property(group, key, value));
  }
  return props;
}

/** Filas estimadas más altas entre los descendientes (avisos "Using temporary" / "Using filesort"). */
function maxRows(nodes: DraftNode[]): number {
  return nodes.reduce((m, n) => Math.max(m, n.estimatedRows ?? 0, maxRows(n.children)), 0);
}

function childrenOf(obj: Json): DraftNode[] {
  const nodes: DraftNode[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (STATS.has(key)) continue;
    if (isObject(value)) nodes.push(nodeFor(key, value));
    else if (Array.isArray(value) && value.some(isObject)) {
      const children = value.filter(isObject).flatMap(childrenOf);
      // Una lista de un solo elemento no necesita su propio nodo.
      if (key === 'query_specifications' || children.length > 1) {
        nodes.push({ operation: LABELS[key] ?? key, properties: [], children });
      } else {
        nodes.push(...children);
      }
    }
  }
  return nodes;
}

function tableNode(key: string, t: Json): DraftNode {
  const access = String(t['access_type'] ?? '');
  const name = t['table_name'] === undefined ? undefined : String(t['table_name']);
  const loops = num(t['r_loops']);
  const perLoop = num(t['r_rows']);
  const tableTime = num(t['r_table_time_ms']);
  const otherTime = num(t['r_other_time_ms']);
  const keyName = t['key'] === undefined ? undefined : String(t['key']);
  const ref = Array.isArray(t['ref']) ? (t['ref'] as unknown[]).join(', ') : undefined;
  const operation = ACCESS[access] ?? (access || 'Table');
  return {
    operation: key === 'block-nl-join' ? `${LABELS[key]} (${operation})` : operation,
    object: name,
    condition:
      t['attached_condition'] !== undefined
        ? String(t['attached_condition'])
        : keyName
          ? `${keyName}${ref ? ` = ${ref}` : ''}`
          : undefined,
    totalCost: tableCost(t),
    estimatedRows: tableRows(t),
    actualRows: perLoop !== undefined ? perLoop * (loops ?? 1) : undefined,
    loops,
    selfTimeMs:
      tableTime !== undefined || otherTime !== undefined ? (tableTime ?? 0) + (otherTime ?? 0) : undefined,
    fullScanRows: access === 'ALL' && name && !name.startsWith('<') ? tableRows(t) : undefined,
    properties: propertiesOf(t, new Set(['table_name'])),
    children: childrenOf(t),
  };
}

function nodeFor(key: string, value: Json): DraftNode {
  if (key === 'table' || key === 'block-nl-join') return tableNode(key, value);
  const children = childrenOf(value);
  const node: DraftNode = {
    operation:
      key === 'query_block' ? `Query block #${String(value['select_id'] ?? '')}` : (LABELS[key] ?? key),
    totalCost:
      num(value['cost']) ??
      (isObject(value['cost_info']) ? num(value['cost_info']['query_cost']) : undefined),
    loops: num(value['r_loops']),
    properties: propertiesOf(value, new Set()),
    children,
  };
  const time = num(value['r_total_time_ms']);
  // En `query_block` el tiempo incluye todo el bloque; en el resto es el de la operación.
  if (key === 'query_block') node.inclusiveTimeMs = time;
  else node.selfTimeMs = time;
  if (key === 'filesort') {
    node.condition = value['sort_key'] === undefined ? undefined : String(value['sort_key']);
    node.actualRows = num(value['r_output_rows']);
    node.spill = value['r_used_priority_queue'] === false && (num(value['r_sort_passes']) ?? 0) > 0;
  }
  const big = maxRows(children) >= PLAN_LIMITS.fullScanRows;
  if (big && key === 'filesort') node.engineWarnings = ['Using filesort'];
  if (big && key === 'temporary_table') node.engineWarnings = ['Using temporary'];
  return node;
}

/**
 * `EXPLAIN FORMAT=JSON` / `ANALYZE FORMAT=JSON` de MariaDB → modelo común.
 * También interpreta el JSON (versión 1) de MySQL, que se usa cuando el
 * formato de árbol no admite la sentencia (`UPDATE`/`DELETE` de una tabla).
 */
export function parseMariaDbPlan(raw: string, statement: string, analyzed: boolean): ExecutionPlan {
  const doc = JSON.parse(raw) as Json;
  const block = isObject(doc['query_block']) ? doc['query_block'] : undefined;
  const optimization = isObject(doc['query_optimization']) ? doc['query_optimization'] : undefined;
  return buildPlan(
    {
      engine: 'mariadb',
      analyzed,
      statement,
      raw,
      rawLanguage: 'json',
      planningMs: num(optimization?.['r_total_time_ms']),
      executionMs: analyzed ? num(block?.['r_total_time_ms']) : undefined,
    },
    childrenOf(doc),
  );
}

/** Nombres de las tablas de un plan JSON (MariaDB o MySQL), para comprobar si admiten transacciones. */
export function planTables(raw: string): string[] {
  const names = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (isObject(value)) {
      const name = value['table_name'];
      if (typeof name === 'string' && !name.startsWith('<')) names.add(name);
      Object.values(value).forEach(visit);
    }
  };
  visit(JSON.parse(raw));
  return [...names];
}

const NUMBER = String.raw`[\d.]+(?:e[+-]?\d+)?`;
const ESTIMATE = new RegExp(String.raw`\((?:cost=(${NUMBER}) )?rows=(${NUMBER})\)`);
const ACTUAL = new RegExp(
  String.raw`\(actual time=(${NUMBER})\.\.(${NUMBER}) rows=(${NUMBER}) loops=(\d+)\)`,
);

/** Descripción de una línea de `EXPLAIN FORMAT=TREE` → operación, objeto y condición. */
function describeTreeLine(text: string): Pick<DraftNode, 'operation' | 'object' | 'condition'> {
  const labeled = /^([A-Za-z][\w -]*?): (.*)$/.exec(text);
  if (labeled) return { operation: labeled[1]!, condition: labeled[2] };
  const on = /^(.*?) on (\S+)(.*)$/.exec(text);
  if (on) {
    const rest = on[3]!.trim();
    return { operation: on[1]!, object: on[2]!.replace(/`/g, ''), condition: rest || undefined };
  }
  return { operation: text };
}

/**
 * `EXPLAIN FORMAT=TREE` / `EXPLAIN ANALYZE` de MySQL 8 (texto en árbol) → modelo común.
 */
export function parseMySqlTreePlan(raw: string, statement: string, analyzed: boolean): ExecutionPlan {
  const roots: DraftNode[] = [];
  const stack: { depth: number; node: DraftNode }[] = [];
  let last: DraftNode | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const m = /^(\s*)-> (.*)$/.exec(line);
    if (!m) {
      // Continuación de una descripción larga.
      if (last && line.trim()) last.properties.push(property('general', 'Detalle', line.trim()));
      continue;
    }
    const depth = Math.floor(m[1]!.length / 4);
    const body = m[2]!;
    const cut = body.search(/ {2}\((?:cost=|rows=|actual )| \(never executed\)/);
    const text = (cut >= 0 ? body.slice(0, cut) : body).trim();
    const tail = cut >= 0 ? body.slice(cut) : '';
    const estimate = ESTIMATE.exec(tail);
    const actual = ACTUAL.exec(tail);
    const loops = actual ? Number(actual[4]) : tail.includes('never executed') ? 0 : undefined;
    const properties: PlanProperty[] = [property('general', 'Operación', text)];
    if (estimate?.[1]) properties.push(property('estimated', 'cost', estimate[1]));
    if (estimate) properties.push(property('estimated', 'rows', estimate[2]));
    if (actual) {
      properties.push(property('actual', 'actual time', `${actual[1]}..${actual[2]}`));
      properties.push(property('actual', 'rows', actual[3]));
      properties.push(property('actual', 'loops', actual[4]));
    }
    const node: DraftNode = {
      ...describeTreeLine(text),
      totalCost: num(estimate?.[1]),
      estimatedRows: num(estimate?.[2]),
      actualRows: actual ? Number(actual[3]) * Number(actual[4]) : loops === 0 ? 0 : undefined,
      loops,
      inclusiveTimeMs: actual ? Number(actual[2]) * Number(actual[4]) : loops === 0 ? 0 : undefined,
      properties,
      children: [],
    };
    if (node.operation === 'Table scan' && node.object && !node.object.startsWith('<')) {
      node.fullScanRows = node.estimatedRows;
    }
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) parent.node.children.push(node);
    else roots.push(node);
    stack.push({ depth, node });
    last = node;
  }
  // Avisos del motor sobre tablas grandes (se calculan con el árbol completo).
  const mark = (node: DraftNode): void => {
    node.children.forEach(mark);
    const rows = Math.max(node.estimatedRows ?? 0, maxRows(node.children));
    if (rows < PLAN_LIMITS.fullScanRows) return;
    if (/^Sort\b/.test(node.operation)) node.engineWarnings = ['Using filesort'];
    else if (/temporary/i.test(node.operation)) node.engineWarnings = ['Using temporary'];
  };
  roots.forEach(mark);
  return buildPlan({ engine: 'mariadb', analyzed, statement, raw, rawLanguage: 'plaintext' }, roots);
}
