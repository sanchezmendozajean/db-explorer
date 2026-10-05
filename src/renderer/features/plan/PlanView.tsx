import { useMemo, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { ExecutionPlan, PlanNode, PlanPropertyGroup } from '@shared/plan';
import { walkPlan } from '@shared/plan';
import { IconButton } from '../../components/Button';
import { Codicon } from '../../components/Codicon';
import type { TreeRow } from '../../components/VirtualTree';
import { VirtualTree } from '../../components/VirtualTree';
import { es } from '../../i18n/es';
import { showToast } from '../../stores/toast-store';
import { ReadOnlyCode } from '../editor/ReadOnlyCode';
import { reexplain } from '../execution/execute';
import { EMPTY_TAB_RESULTS, useResultsStore } from '../results/results-store';
import {
  ancestorsOf,
  formatCost,
  formatMs,
  formatNumber,
  formatXml,
  nodesWithWarnings,
  planIcon,
  planSummary,
  rowText,
  warningText,
} from './plan-format';

type ColumnId = 'operation' | 'object' | 'cost' | 'estimatedRows' | 'actualRows' | 'loops' | 'time';

const DEFAULT_WIDTHS: Record<ColumnId, number> = {
  operation: 320,
  object: 180,
  cost: 120,
  estimatedRows: 90,
  actualRows: 90,
  loops: 64,
  time: 130,
};
const MIN_WIDTH = 48;
const INDENT = 12;
const ROW_HEIGHT = 22;
/** Fila con la condición como segunda línea. */
const ROW_HEIGHT_CONDITION = 36;
/** Relleno del árbol antes de la operación: margen (8) + chevron (16 + 2). */
const ROW_LEAD = 26;

interface PlanRow extends TreeRow {
  node: PlanNode;
}

function flatten(
  nodes: PlanNode[],
  collapsed: ReadonlySet<string>,
  depth = 0,
  out: PlanRow[] = [],
): PlanRow[] {
  for (const node of nodes) {
    const expandable = node.children.length > 0;
    const expanded = expandable && !collapsed.has(node.id);
    out.push({ id: node.id, depth, expandable, expanded, node });
    if (expanded) flatten(node.children, collapsed, depth + 1, out);
  }
  return out;
}

/** Columnas con datos: SQLite no tiene costos; los planes estimados no tienen valores reales. */
function visibleColumns(plan: ExecutionPlan, nodes: PlanNode[]): ColumnId[] {
  const has = (pick: (n: PlanNode) => number | undefined): boolean =>
    nodes.some((n) => pick(n) !== undefined);
  const columns: ColumnId[] = ['object'];
  // La operación siempre se muestra (es la primera columna, con la sangría del árbol).
  if (has((n) => n.totalCost)) columns.push('cost');
  if (has((n) => n.estimatedRows)) columns.push('estimatedRows');
  if (plan.analyzed && has((n) => n.actualRows)) columns.push('actualRows');
  if (plan.analyzed && nodes.some((n) => (n.loops ?? 0) > 1)) columns.push('loops');
  if (plan.analyzed && has((n) => n.actualTimeMs)) columns.push('time');
  return columns;
}

/** Cada plan nuevo reinicia la vista (expansión, selección, detalle). */
const planKeys = new WeakMap<ExecutionPlan, number>();
let nextPlanKey = 0;
function keyOf(plan: ExecutionPlan): number {
  let key = planKeys.get(plan);
  if (key === undefined) {
    key = nextPlanKey++;
    planKeys.set(plan, key);
  }
  return key;
}

/** Pestaña Plan del panel de resultados (specs/12 §5). */
export function PlanView({ tabId }: { tabId: string }): React.JSX.Element {
  const plan = useResultsStore((s) => (s.byTab[tabId] ?? EMPTY_TAB_RESULTS).plan);
  const pending = useResultsStore((s) => (s.byTab[tabId] ?? EMPTY_TAB_RESULTS).planPending);
  if (pending || !plan) {
    return (
      <div className="panel-body plan-loading" data-testid="plan-loading">
        <div className="progress-bar" role="progressbar" aria-label={es.plan.loading} />
        <p>{es.plan.loading}</p>
      </div>
    );
  }
  return <PlanContent key={keyOf(plan)} tabId={tabId} plan={plan} />;
}

function PlanContent({ tabId, plan }: { tabId: string; plan: ExecutionPlan }): React.JSX.Element {
  const t = es.plan;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState(false);
  const [raw, setRaw] = useState(false);
  const [widths, setWidths] = useState(DEFAULT_WIDTHS);
  const [warningIndex, setWarningIndex] = useState(-1);

  const nodes = useMemo(() => [...walkPlan(plan.roots)], [plan]);
  const rows = useMemo(() => flatten(plan.roots, collapsed), [plan, collapsed]);
  const warned = useMemo(() => nodesWithWarnings(plan), [plan]);
  const columns = useMemo(() => visibleColumns(plan, nodes), [plan, nodes]);
  const totalTime = useMemo(() => nodes.reduce((sum, n) => sum + (n.actualTimeMs ?? 0), 0), [nodes]);
  const warningCount = warned.reduce((sum, n) => sum + n.warnings.length, 0);
  const selected = selectedId ? nodes.find((n) => n.id === selectedId) : undefined;

  const toggle = (id: string, expanded: boolean): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (expanded) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Clic en el contador de avisos: salta al siguiente nodo con avisos (expandiendo sus ancestros). */
  const nextWarning = (): void => {
    if (warned.length === 0) return;
    const index = (warningIndex + 1) % warned.length;
    const node = warned[index]!;
    setWarningIndex(index);
    const ancestors = ancestorsOf(plan, node.id);
    setCollapsed((prev) => new Set([...prev].filter((id) => !ancestors.includes(id))));
    setSelectedId(node.id);
  };

  const copyText = async (text: string): Promise<boolean> => {
    const r = await window.api.app.clipboardWrite({ text });
    if (!r.ok) showToast('error', r.error.message);
    return r.ok;
  };

  const startResize = (e: React.MouseEvent, column: ColumnId): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widths[column];
    const move = (ev: MouseEvent): void =>
      setWidths((w) => ({ ...w, [column]: Math.max(MIN_WIDTH, startWidth + ev.clientX - startX) }));
    const up = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const cell = (column: ColumnId, n: PlanNode): React.ReactNode => {
    switch (column) {
      case 'object':
        return (
          <span className="plan-object" title={n.alias ? `${n.object ?? ''} ${n.alias}` : n.object}>
            {n.object}
            {n.alias && <span className="plan-alias"> {n.alias}</span>}
          </span>
        );
      case 'cost':
        return n.selfCost === undefined ? null : (
          <Bar
            fraction={plan.totalCost ? n.selfCost / plan.totalCost : 0}
            text={formatCost(n.selfCost)}
            title={`${t.detail.selfCost}: ${formatCost(n.selfCost)} · ${t.detail.totalCost}: ${formatCost(n.totalCost ?? 0)}`}
          />
        );
      case 'estimatedRows':
        return n.estimatedRows === undefined ? null : formatNumber(n.estimatedRows);
      case 'actualRows': {
        if (n.actualRows === undefined) return null;
        const off = n.warnings.some((w) => w.kind === 'misestimate');
        return <span className={off ? 'plan-misestimate' : undefined}>{formatNumber(n.actualRows)}</span>;
      }
      case 'loops':
        return n.loops === undefined ? null : formatNumber(n.loops);
      case 'time':
        return n.actualTimeMs === undefined ? null : (
          <Bar fraction={totalTime ? n.actualTimeMs / totalTime : 0} text={formatMs(n.actualTimeMs)} />
        );
    }
  };

  const tree = (
    <div className="plan-table">
      <div className="plan-header" role="row">
        {(['operation', ...columns] as ColumnId[]).map((c) => (
          <div
            key={c}
            className={c === 'operation' ? 'plan-header-cell plan-header-op' : 'plan-header-cell'}
            style={{ width: widths[c] }}
          >
            {t.columns[c]}
            <span className="plan-resizer" onMouseDown={(e) => startResize(e, c)} />
          </div>
        ))}
      </div>
      <VirtualTree<PlanRow>
        rows={rows}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onToggle={toggle}
        toggleOnClick={false}
        onRowClick={(row) => {
          setSelectedId(row.id);
          setDetail(true);
        }}
        onOpen={(row) => {
          setSelectedId(row.id);
          setDetail(true);
        }}
        onRowKeyDown={(e, row) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
            void copyText(rowText(row.node));
            return true;
          }
          if (e.key === 'Escape' && detail) {
            setDetail(false);
            return true;
          }
          return false;
        }}
        ariaLabel={t.treeLabel}
        focusContext="planFocus"
        indent={INDENT}
        rowSize={(row) => (row.node.condition ? ROW_HEIGHT_CONDITION : ROW_HEIGHT)}
        renderRow={(row) => {
          const n = row.node;
          return (
            <>
              <div
                className="plan-op"
                style={{ width: Math.max(MIN_WIDTH, widths.operation - ROW_LEAD - row.depth * INDENT) }}
                data-testid="plan-node"
                data-operation={n.operation}
              >
                <div className="plan-op-line">
                  <Codicon name={planIcon(n.operation)} size={14} className="plan-op-icon" />
                  <span className="plan-op-name">{n.operation}</span>
                  {n.warnings.length > 0 && (
                    <span className="plan-warning-icon" title={n.warnings.map(warningText).join('\n')}>
                      <Codicon name="warning" size={14} color="var(--warning)" />
                    </span>
                  )}
                </div>
                {n.condition && (
                  <div className="plan-condition" title={n.condition}>
                    {n.condition}
                  </div>
                )}
              </div>
              {columns.map((c) => (
                <div key={c} className={`plan-cell plan-cell-${c}`} style={{ width: widths[c] }}>
                  {cell(c, n)}
                </div>
              ))}
            </>
          );
        }}
      />
    </div>
  );

  return (
    <div
      className="plan-view"
      data-testid="plan-view"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && detail) {
          e.stopPropagation();
          setDetail(false);
        }
      }}
    >
      <div className="results-toolbar plan-toolbar">
        <span className={plan.analyzed ? 'plan-chip is-real' : 'plan-chip'} data-testid="plan-kind">
          {plan.analyzed ? t.analyzed : t.estimated}
        </span>
        <span className="plan-summary" data-testid="plan-summary">
          {planSummary(plan)}
        </span>
        {warningCount > 0 && (
          <button
            type="button"
            className="plan-warnings"
            title={t.nextWarning}
            data-testid="plan-warnings"
            onClick={nextWarning}
          >
            <Codicon name="warning" size={14} />
            {t.warnings(warningCount)}
          </button>
        )}
        <span className="toolbar-spacer" />
        <IconButton
          icon="expand-all"
          label={t.expandAll}
          disabled={raw}
          onClick={() => setCollapsed(new Set())}
        />
        <IconButton
          icon="collapse-all"
          label={t.collapseAll}
          disabled={raw}
          onClick={() => setCollapsed(new Set(nodes.filter((n) => n.children.length > 0).map((n) => n.id)))}
        />
        <IconButton
          icon="code"
          label={raw ? t.viewTree : t.viewOriginal}
          active={raw}
          data-testid="plan-view-original"
          onClick={() => setRaw((v) => !v)}
        />
        <IconButton
          icon="copy"
          label={t.copyOriginal}
          onClick={() => void copyText(plan.raw).then((ok) => ok && showToast('info', t.copied))}
        />
        <IconButton icon="refresh" label={t.reexplain} onClick={() => void reexplain(tabId)} />
      </div>
      <div className="panel-body plan-body">
        {raw ? (
          <ReadOnlyCode
            text={plan.rawLanguage === 'xml' ? formatXml(plan.raw) : plan.raw}
            language={plan.rawLanguage}
            ariaLabel={t.viewOriginal}
            testId="plan-raw"
          />
        ) : (
          // El árbol queda siempre en el mismo panel: abrir el detalle no lo vuelve a montar ni le quita el foco.
          <Group id="plan-detail-split" orientation="horizontal" className="split">
            <Panel id="plan-tree-panel" minSize={240}>
              {tree}
            </Panel>
            {detail && selected && (
              <>
                <Separator className="sash sash-vertical" />
                <Panel id="plan-detail-panel" minSize={180} defaultSize={300}>
                  <PlanDetail node={selected} analyzed={plan.analyzed} onClose={() => setDetail(false)} />
                </Panel>
              </>
            )}
          </Group>
        )}
      </div>
    </div>
  );
}

/** Barra horizontal de 60 px con el porcentaje (en `warning` si supera la mitad) y el número. */
function Bar({
  fraction,
  text,
  title,
}: {
  fraction: number;
  text: string;
  title?: string;
}): React.JSX.Element {
  const pct = Math.max(0, Math.min(1, fraction));
  return (
    <span className="plan-bar-cell" title={title ?? `${Math.round(pct * 100)} %`}>
      <span className="plan-bar">
        <span
          className={pct > 0.5 ? 'plan-bar-fill is-hot' : 'plan-bar-fill'}
          style={{ width: `${pct * 100}%` }}
        />
      </span>
      <span className="plan-bar-value">{text}</span>
    </span>
  );
}

/** Panel de detalle: todo lo que el motor informó del nodo, por grupos (specs/12 §5). */
function PlanDetail({
  node,
  analyzed,
  onClose,
}: {
  node: PlanNode;
  analyzed: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const t = es.plan.detail;
  const entries: Record<PlanPropertyGroup, { label: string; value: string; mono?: boolean }[]> = {
    general: [],
    estimated: [],
    actual: [],
  };
  const add = (group: PlanPropertyGroup, label: string, value: string | undefined, mono = false): void => {
    if (value !== undefined && value !== '') entries[group].push({ label, value, mono });
  };
  add('general', t.operation, node.operation);
  add('general', t.object, node.object);
  add('general', t.alias, node.alias);
  add('general', t.condition, node.condition, true);
  add('estimated', t.totalCost, node.totalCost === undefined ? undefined : formatCost(node.totalCost));
  add('estimated', t.selfCost, node.selfCost === undefined ? undefined : formatCost(node.selfCost));
  add(
    'estimated',
    t.estimatedRows,
    node.estimatedRows === undefined ? undefined : formatNumber(node.estimatedRows),
  );
  if (analyzed) {
    add('actual', t.actualRows, node.actualRows === undefined ? undefined : formatNumber(node.actualRows));
    add('actual', t.loops, node.loops === undefined ? undefined : formatNumber(node.loops));
    add('actual', t.time, node.actualTimeMs === undefined ? undefined : formatMs(node.actualTimeMs));
  }
  for (const p of node.properties) add(p.group, p.label, p.value, true);
  const sections: { title: string; items: { label: string; value: string; mono?: boolean }[] }[] = [
    { title: t.general, items: entries.general },
    { title: t.estimated, items: entries.estimated },
    { title: t.actual, items: entries.actual },
    { title: t.warnings, items: node.warnings.map((w) => ({ label: '', value: warningText(w) })) },
  ];
  return (
    <aside className="value-viewer plan-detail" aria-label={t.title} data-testid="plan-detail">
      <div className="value-viewer-header">
        <span className="value-viewer-title">{node.operation}</span>
        <IconButton icon="close" label={t.close} onClick={onClose} />
      </div>
      <div className="plan-detail-body">
        {sections
          .filter((s) => s.items.length > 0)
          .map((s) => (
            <section key={s.title} className="plan-detail-section">
              <h4>{s.title}</h4>
              <dl>
                {s.items.map((item, i) => (
                  <div key={`${item.label}-${i}`} className="plan-detail-item">
                    {item.label && <dt>{item.label}</dt>}
                    <dd className={item.mono ? 'is-mono' : undefined}>{item.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
      </div>
    </aside>
  );
}
