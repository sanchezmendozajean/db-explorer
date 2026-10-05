import type { ExecutionPlan, PlanNode, PlanWarning } from '@shared/plan';
import { walkPlan } from '@shared/plan';
import { es } from '../../i18n/es';

/** Ícono por familia de operación (specs/12 §5). */
export function planIcon(operation: string): string {
  const op = operation.toLowerCase();
  if (/aggregate|group|window|distinct|\(aggregate\)/.test(op)) return 'symbol-operator';
  if (/join|nested loop|hash match|merge|semi|anti/.test(op)) return 'merge';
  if (/sort|filesort|top n/.test(op)) return 'list-ordered';
  if (/index|seek|lookup|key|primary/.test(op)) return 'key';
  if (/scan|table|search|heap|rid/.test(op)) return 'table';
  return 'circle-outline';
}

export function formatNumber(n: number, digits = 0): string {
  return n.toLocaleString('es', { maximumFractionDigits: digits });
}

export function formatCost(n: number): string {
  return formatNumber(n, n < 10 ? 2 : 1);
}

export function formatMs(n: number): string {
  return `${formatNumber(n, n < 10 ? 3 : 1)} ms`;
}

export function warningText(w: PlanWarning): string {
  switch (w.kind) {
    case 'fullScan':
      return es.plan.warning.fullScan(formatNumber(w.rows));
    case 'misestimate':
      return es.plan.warning.misestimate(formatNumber(w.estimated), formatNumber(w.actual));
    case 'spill':
      return es.plan.warning.spill;
    case 'engine':
      return w.message;
  }
}

/** Resumen de la barra: "Costo total 247,6 · Planificación 0,4 ms · Ejecución 12,3 ms". */
export function planSummary(plan: ExecutionPlan): string {
  const parts: string[] = [];
  if (plan.totalCost !== undefined) parts.push(es.plan.totalCost(formatCost(plan.totalCost)));
  if (plan.planningMs !== undefined) parts.push(es.plan.planning(formatMs(plan.planningMs)));
  if (plan.executionMs !== undefined) parts.push(es.plan.execution(formatMs(plan.executionMs)));
  return parts.join(' · ');
}

/** Fila como texto para Ctrl+C: "Operación · Objeto · Costo · Filas". */
export function rowText(node: PlanNode): string {
  const rows = node.actualRows ?? node.estimatedRows;
  return [
    node.operation,
    node.object ?? '',
    node.totalCost === undefined ? '' : formatCost(node.totalCost),
    rows === undefined ? '' : formatNumber(rows),
  ].join(' · ');
}

/** Nodos con avisos, en el orden de la vista. */
export function nodesWithWarnings(plan: ExecutionPlan): PlanNode[] {
  return [...walkPlan(plan.roots)].filter((n) => n.warnings.length > 0);
}

/** Ids de los ancestros de un nodo (para expandirlos al saltar a él). */
export function ancestorsOf(plan: ExecutionPlan, id: string): string[] {
  const path: string[] = [];
  const visit = (nodes: PlanNode[]): boolean => {
    for (const node of nodes) {
      if (node.id === id) return true;
      path.push(node.id);
      if (visit(node.children)) return true;
      path.pop();
    }
    return false;
  };
  visit(plan.roots);
  return path;
}

/** Sangría de un XML en una sola línea (showplan de SQL Server) para "Ver original". */
export function formatXml(xml: string): string {
  if (xml.includes('\n')) return xml;
  const lines: string[] = [];
  let depth = 0;
  // La última línea abrió un elemento con texto: su cierre va en la misma línea.
  let inline = false;
  const append = (text: string): void => {
    lines[lines.length - 1] = `${lines[lines.length - 1] ?? ''}${text}`;
  };
  for (const token of xml.split(/(<[^>]+>)/).filter((t) => t.trim())) {
    if (!token.startsWith('<')) {
      append(token);
      inline = true;
    } else if (token.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      if (inline) append(token);
      else lines.push(`${'  '.repeat(depth)}${token}`);
      inline = false;
    } else {
      lines.push(`${'  '.repeat(depth)}${token}`);
      if (!token.endsWith('/>') && !token.startsWith('<?') && !token.startsWith('<!')) depth++;
      inline = false;
    }
  }
  return lines.join('\n');
}
