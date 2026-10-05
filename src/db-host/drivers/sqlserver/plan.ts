import { XMLParser } from 'fast-xml-parser';
import type { ExecutionPlan, PlanProperty } from '@shared/plan';
import type { DraftNode } from '../plan-builder';
import { buildPlan, num, property } from '../plan-builder';

/** Elemento del showplan: atributos en `$` y cada hijo como lista. */
interface El {
  $?: Record<string, string>;
  [child: string]: El[] | Record<string, string> | undefined;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  attributesGroupName: '$',
  removeNSPrefix: true,
  parseAttributeValue: false,
  isArray: (_name, _path, _leaf, isAttribute) => !isAttribute,
});

const attrs = (el: El | undefined): Record<string, string> => el?.$ ?? {};

function kids(el: El): [string, El][] {
  const out: [string, El][] = [];
  for (const [key, value] of Object.entries(el)) {
    if (key === '$' || !Array.isArray(value)) continue;
    for (const child of value) if (child && typeof child === 'object') out.push([key, child]);
  }
  return out;
}

/** Elementos `name` debajo de `el` sin entrar en otros `RelOp` (los hijos del nodo). */
function findAll(el: El, name: string, crossRelOps = false): El[] {
  const found: El[] = [];
  for (const [key, child] of kids(el)) {
    if (key === name) found.push(child);
    if (key !== 'RelOp' || crossRelOps) found.push(...findAll(child, name, crossRelOps));
  }
  return found;
}

const unbracket = (s: string | undefined): string | undefined => s?.replace(/^\[|\]$/g, '');

/** `[db].[esquema].[tabla].[col] as [alias].[col]` → `alias.col` (condiciones legibles). */
function simplify(text: string): string {
  return text
    .replace(/\[[^\]]+\]\.\[[^\]]+\]\.\[[^\]]+\]\.\[([^\]]+)\] as \[([^\]]+)\]\.\[[^\]]+\]/g, '$2.$1')
    .replace(/\[[^\]]+\]\.\[[^\]]+\]\.\[([^\]]+)\]\.\[([^\]]+)\]/g, '$1.$2');
}

function columnName(ref: El): string {
  const a = attrs(ref);
  const table = unbracket(a['Alias']) ?? unbracket(a['Table']);
  return table ? `${table}.${a['Column'] ?? ''}` : (a['Column'] ?? '');
}

/** Primera expresión de un elemento (`ScalarOperator/@ScalarString`). */
function scalarText(el: El): string | undefined {
  const [op] = findAll(el, 'ScalarOperator');
  const text = op ? attrs(op)['ScalarString'] : undefined;
  return text === undefined ? undefined : simplify(text);
}

const SCAN_OPS: Record<string, string> = { EQ: '=', GT: '>', GE: '>=', LT: '<', LE: '<=', NE: '<>' };

/** Predicado de búsqueda de índice: `col = expr AND …`. */
function seekText(el: El): string | undefined {
  const parts: string[] = [];
  for (const kind of ['Prefix', 'StartRange', 'EndRange']) {
    for (const range of findAll(el, kind)) {
      const cols = findAll(range, 'RangeColumns').flatMap((r) => findAll(r, 'ColumnReference'));
      const exprs = findAll(range, 'RangeExpressions').flatMap((r) => findAll(r, 'ScalarOperator'));
      const op = SCAN_OPS[attrs(range)['ScanType'] ?? 'EQ'] ?? '=';
      cols.forEach((col, i) => {
        const expr = exprs[i] ? attrs(exprs[i])['ScalarString'] : undefined;
        parts.push(`${columnName(col)} ${op} ${simplify(expr ?? '?')}`);
      });
    }
  }
  return parts.length > 0 ? parts.join(' AND ') : undefined;
}

/** Contenedores de condiciones, en orden de preferencia para la segunda línea. */
const CONDITIONS = ['SeekPredicates', 'Predicate', 'ProbeResidual', 'Residual', 'BuildResidual', 'PassThru'];

/** Hijos del `RelOp` que no son el elemento de la operación física. */
const RELOP_META = new Set([
  'OutputList',
  'Warnings',
  'MemoryFractions',
  'RunTimeInformation',
  'RunTimePartitionSummary',
  'InternalInfo',
]);

const ESTIMATED = [
  'EstimateRows',
  'EstimatedRowsRead',
  'EstimateIO',
  'EstimateCPU',
  'AvgRowSize',
  'EstimatedTotalSubtreeCost',
  'TableCardinality',
  'EstimateRebinds',
  'EstimateRewinds',
];

function warningTexts(warnings: El): { spill: boolean; messages: string[] } {
  let spill = false;
  const messages: string[] = [];
  for (const [key, value] of Object.entries(attrs(warnings))) {
    if (value === 'true' || value === '1') messages.push(key);
  }
  for (const [key, child] of kids(warnings)) {
    if (key === 'SpillToTempDb' || key.endsWith('SpillDetails')) {
      spill = true;
      continue;
    }
    const detail = Object.entries(attrs(child))
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    const columns = findAll(child, 'ColumnReference', true).map(columnName);
    messages.push([key, detail, columns.length > 0 ? columns.join(', ') : ''].filter(Boolean).join(': '));
  }
  return { spill, messages };
}

function missingIndexTexts(plan: El): string[] {
  return findAll(plan, 'MissingIndexGroup', true).flatMap((group) => {
    const impact = num(attrs(group)['Impact']);
    return findAll(group, 'MissingIndex').map((mi) => {
      const a = attrs(mi);
      const columns = findAll(mi, 'ColumnGroup')
        .map(
          (g) =>
            `${attrs(g)['Usage'] ?? ''}: ${findAll(g, 'Column')
              .map((c) => attrs(c)['Name'])
              .join(', ')}`,
        )
        .join('; ');
      const impactText = impact === undefined ? '' : ` (impact ${impact.toFixed(1)}%)`;
      return `Missing index${impactText}: ${a['Database'] ?? ''}.${a['Schema'] ?? ''}.${a['Table'] ?? ''} — ${columns}`;
    });
  });
}

function relOpNode(rel: El, analyzed: boolean): DraftNode {
  const a = attrs(rel);
  const physical = a['PhysicalOp'] ?? '?';
  const logical = a['LogicalOp'];
  const opEntry = kids(rel).find(([key]) => !RELOP_META.has(key) && key !== 'RelOp');
  const properties: PlanProperty[] = [];
  for (const key of ['PhysicalOp', 'LogicalOp', 'NodeId', 'Parallel', 'EstimatedExecutionMode']) {
    if (a[key] !== undefined) properties.push(property('general', key, a[key]));
  }
  if (opEntry) {
    for (const [k, v] of Object.entries(attrs(opEntry[1])))
      properties.push(property('general', `${opEntry[0]}.${k}`, v));
  }

  const [obj] = findAll(rel, 'Object');
  let object: string | undefined;
  let alias: string | undefined;
  let table: string | undefined;
  if (obj) {
    const o = attrs(obj);
    table = unbracket(o['Table']);
    const schema = unbracket(o['Schema']);
    const index = unbracket(o['Index']);
    object = [schema, table, index].filter(Boolean).join('.');
    alias = unbracket(o['Alias']);
    if (alias === table) alias = undefined;
    for (const [k, v] of Object.entries(o)) properties.push(property('general', `Object.${k}`, v));
  }

  let condition: string | undefined;
  for (const name of CONDITIONS) {
    for (const el of findAll(rel, name)) {
      const text = name === 'SeekPredicates' ? seekText(el) : scalarText(el);
      if (text === undefined) continue;
      properties.push(property('general', name, text));
      condition ??= text;
    }
  }
  const [output] = findAll(rel, 'OutputList');
  if (output) {
    const cols = findAll(output, 'ColumnReference').map(columnName);
    if (cols.length > 0) properties.push(property('general', 'OutputList', cols.join(', ')));
  }

  for (const key of ESTIMATED) if (a[key] !== undefined) properties.push(property('estimated', key, a[key]));

  // Contadores reales: se suman los hilos (el tiempo transcurrido es el máximo).
  const threads = findAll(rel, 'RunTimeCountersPerThread');
  let actualRows: number | undefined;
  let loops: number | undefined;
  let elapsed: number | undefined;
  let batchMode = false;
  if (analyzed && threads.length > 0) {
    const totals = new Map<string, number>();
    for (const t of threads) {
      for (const [k, v] of Object.entries(attrs(t))) {
        const n = num(v);
        if (n === undefined || k === 'Thread') continue;
        totals.set(k, k === 'ActualElapsedms' ? Math.max(totals.get(k) ?? 0, n) : (totals.get(k) ?? 0) + n);
      }
      if (attrs(t)['ActualExecutionMode'] === 'Batch') batchMode = true;
    }
    for (const [k, v] of totals) properties.push(property('actual', k, v));
    actualRows = totals.get('ActualRows');
    loops = totals.get('ActualExecutions');
    elapsed = totals.get('ActualElapsedms');
  }

  // Solo los avisos del propio operador (los de la sentencia van en la raíz).
  const warnings = (rel['Warnings'] as El[] | undefined) ?? [];
  let spill = false;
  const engineWarnings: string[] = [];
  for (const w of warnings) {
    const r = warningTexts(w);
    spill ||= r.spill;
    engineWarnings.push(...r.messages);
  }

  const isTableScan = physical === 'Table Scan' || physical === 'Clustered Index Scan';
  const temp = table?.startsWith('#') || table?.startsWith('@');
  return {
    operation: logical && logical !== physical ? `${physical} (${logical})` : physical,
    object,
    alias,
    condition,
    totalCost: num(a['EstimatedTotalSubtreeCost']),
    estimatedRows: num(a['EstimateRows']),
    actualRows,
    loops,
    // En modo fila el tiempo incluye a los hijos; en modo lote es el del operador.
    inclusiveTimeMs: batchMode ? undefined : elapsed,
    selfTimeMs: batchMode ? elapsed : undefined,
    fullScanRows:
      isTableScan && !temp ? (num(a['TableCardinality']) ?? num(a['EstimatedRowsRead'])) : undefined,
    spill,
    engineWarnings,
    properties,
    children: findAll(rel, 'RelOp').map((child) => relOpNode(child, analyzed)),
  };
}

/**
 * Showplan XML (`SET SHOWPLAN_XML` / `SET STATISTICS XML`) → modelo común.
 * Cada sentencia con plan aporta una raíz.
 */
export function parseSqlServerPlan(xmls: string[], statement: string, analyzed: boolean): ExecutionPlan {
  const roots: DraftNode[] = [];
  let totalCost: number | undefined;
  let planningMs: number | undefined;
  let executionMs: number | undefined;
  for (const xml of xmls) {
    const doc = parser.parse(xml) as El;
    for (const stmt of findAll(doc, 'StmtSimple', true)) {
      const [plan] = findAll(stmt, 'QueryPlan');
      const [rel] = plan ? findAll(plan, 'RelOp') : [];
      if (!plan || !rel) continue;
      const root = relOpNode(rel, analyzed);
      const statementWarnings = (plan['Warnings'] as El[] | undefined) ?? [];
      for (const w of statementWarnings) {
        const r = warningTexts(w);
        root.spill ||= r.spill;
        root.engineWarnings = [...(root.engineWarnings ?? []), ...r.messages];
      }
      root.engineWarnings = [...(root.engineWarnings ?? []), ...missingIndexTexts(plan)];
      roots.push(root);
      totalCost = (totalCost ?? 0) + (num(attrs(stmt)['StatementSubTreeCost']) ?? 0);
      const compile = num(attrs(plan)['CompileTime']);
      if (compile !== undefined) planningMs = (planningMs ?? 0) + compile;
      const [stats] = findAll(plan, 'QueryTimeStats');
      const elapsed = num(attrs(stats)['ElapsedTime']);
      if (analyzed && elapsed !== undefined) executionMs = (executionMs ?? 0) + elapsed;
    }
  }
  const raw = xmls.join('\n');
  return buildPlan(
    { engine: 'sqlserver', analyzed, statement, raw, rawLanguage: 'xml', planningMs, executionMs, totalCost },
    roots,
  );
}
