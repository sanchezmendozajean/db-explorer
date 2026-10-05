import type { ExecutionPlan } from '@shared/plan';
import type { DraftNode } from '../plan-builder';
import { buildPlan, property } from '../plan-builder';

/** Fila de `EXPLAIN QUERY PLAN`: `id, parent, notused, detail`. */
export interface SqlitePlanRow {
  id: number;
  parent: number;
  detail: string;
}

/** "SCAN t", "SEARCH t USING INDEX i (a=?)", "USE TEMP B-TREE FOR ORDER BY"… */
function describe(detail: string): Pick<DraftNode, 'operation' | 'object' | 'condition'> {
  const m = /^(SCAN|SEARCH)\s+(?:TABLE\s+)?(\S+)(?:\s+AS\s+(\S+))?(?:\s+(.*))?$/.exec(detail);
  if (!m) return { operation: detail };
  return { operation: m[1]!, object: m[3] ? `${m[2]!} ${m[3]}` : m[2], condition: m[4] };
}

/**
 * `EXPLAIN QUERY PLAN` → modelo común. SQLite no entrega costos ni filas
 * estimadas: solo la forma del árbol.
 */
export function parseSqlitePlan(rows: SqlitePlanRow[], statement: string): ExecutionPlan {
  const nodes = new Map<number, DraftNode>();
  const roots: DraftNode[] = [];
  for (const row of rows) {
    const node: DraftNode = {
      ...describe(row.detail),
      properties: [property('general', 'detail', row.detail), property('general', 'id', row.id)],
      children: [],
    };
    nodes.set(row.id, node);
    const parent = nodes.get(row.parent);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return buildPlan(
    {
      engine: 'sqlite',
      analyzed: false,
      statement,
      raw: JSON.stringify(rows, null, 2),
      rawLanguage: 'json',
    },
    roots,
  );
}
