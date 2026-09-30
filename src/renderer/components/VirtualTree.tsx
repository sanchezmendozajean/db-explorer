import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Codicon } from './Codicon';

export interface TreeRow {
  id: string;
  depth: number;
  expandable: boolean;
  expanded: boolean;
  /** Muestra un spinner en lugar del chevron (carga en curso). */
  loading?: boolean;
}

export interface VirtualTreeProps<T extends TreeRow> {
  rows: T[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string, expanded: boolean) => void;
  /** Enter o doble clic. */
  onOpen?: (row: T) => void;
  onContextMenu?: (row: T, event: React.MouseEvent) => void;
  renderRow: (row: T) => ReactNode;
  ariaLabel: string;
  rowHeight?: number;
  /** Sangría por nivel, en px. */
  indent?: number;
  /** Relleno izquierdo del nivel 0, en px. */
  basePadding?: number;
  /** Contexto de foco para cláusulas `when` (p. ej. `treeFocus`). */
  focusContext?: string;
}

/**
 * Árbol virtualizado estilo VS Code. Recibe las filas visibles ya aplanadas;
 * el estado de expansión lo maneja el llamador.
 */
export function VirtualTree<T extends TreeRow>({
  rows,
  selectedId,
  onSelect,
  onToggle,
  onOpen,
  onContextMenu,
  renderRow,
  ariaLabel,
  rowHeight = 22,
  indent = 8,
  basePadding = 8,
  focusContext = 'treeFocus',
}: VirtualTreeProps<T>): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  // TanStack Virtual no es compatible con la memoización del React Compiler; este componente se omite a propósito.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  const selectedIndex = rows.findIndex((r) => r.id === selectedId);

  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
  }, [selectedIndex, virtualizer]);

  const parentIndex = (index: number): number => {
    const depth = rows[index]?.depth ?? 0;
    for (let i = index - 1; i >= 0; i--) if (rows[i]!.depth < depth) return i;
    return -1;
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (rows.length === 0) return;
    const index = selectedIndex < 0 ? 0 : selectedIndex;
    const row = rows[index]!;
    const select = (i: number): void => onSelect(rows[Math.max(0, Math.min(rows.length - 1, i))]!.id);
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? rowHeight) / rowHeight) - 1);
    switch (e.key) {
      case 'ArrowDown':
        select(selectedIndex < 0 ? 0 : index + 1);
        break;
      case 'ArrowUp':
        select(index - 1);
        break;
      case 'PageDown':
        select(index + page);
        break;
      case 'PageUp':
        select(index - page);
        break;
      case 'Home':
        select(0);
        break;
      case 'End':
        select(rows.length - 1);
        break;
      case 'ArrowRight':
        if (row.expandable && !row.expanded) onToggle(row.id, true);
        else if (row.expandable && rows[index + 1]?.depth === row.depth + 1) select(index + 1);
        break;
      case 'ArrowLeft':
        if (row.expandable && row.expanded) onToggle(row.id, false);
        else if (parentIndex(index) >= 0) select(parentIndex(index));
        break;
      case 'Enter':
        if (onOpen) onOpen(row);
        else if (row.expandable) onToggle(row.id, !row.expanded);
        break;
      case ' ':
        if (row.expandable) onToggle(row.id, !row.expanded);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const guideOffset = basePadding + 8;

  return (
    <div
      ref={scrollRef}
      className="tree"
      role="tree"
      aria-label={ariaLabel}
      tabIndex={0}
      data-focus-context={focusContext}
      aria-activedescendant={selectedIndex >= 0 ? `${baseId}-${selectedIndex}` : undefined}
      onKeyDown={onKeyDown}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]!;
          const selected = row.id === selectedId;
          return (
            <div
              key={row.id}
              id={`${baseId}-${item.index}`}
              role="treeitem"
              aria-level={row.depth + 1}
              aria-expanded={row.expandable ? row.expanded : undefined}
              aria-selected={selected}
              className={['tree-row', selected ? 'is-selected' : ''].join(' ')}
              style={{
                height: rowHeight,
                transform: `translateY(${item.start}px)`,
                paddingLeft: basePadding + row.depth * indent,
              }}
              onMouseDown={(e) => {
                if (e.button === 0 || e.button === 2) onSelect(row.id);
              }}
              onClick={(e) => {
                if (row.expandable && e.detail === 1) onToggle(row.id, !row.expanded);
              }}
              onDoubleClick={() => onOpen?.(row)}
              onContextMenu={(e) => onContextMenu?.(row, e)}
            >
              {Array.from({ length: row.depth }, (_, d) => (
                <span key={d} className="tree-guide" style={{ left: guideOffset + d * indent }} />
              ))}
              <span className="tree-twistie">
                {row.loading ? (
                  <Codicon name="loading" spin size={14} />
                ) : row.expandable ? (
                  <Codicon name={row.expanded ? 'chevron-down' : 'chevron-right'} size={16} />
                ) : null}
              </span>
              {renderRow(row)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Aplana nodos anidados según los expandidos (utilidad para quien usa `VirtualTree`). */
export function flattenTree<N extends { id: string; children?: N[] }>(
  nodes: N[],
  expanded: ReadonlySet<string>,
  depth = 0,
  out: (TreeRow & { node: N })[] = [],
): (TreeRow & { node: N })[] {
  for (const node of nodes) {
    const expandable = node.children !== undefined;
    const isExpanded = expandable && expanded.has(node.id);
    out.push({ id: node.id, depth, expandable, expanded: isExpanded, node });
    if (isExpanded && node.children) flattenTree(node.children, expanded, depth + 1, out);
  }
  return out;
}
