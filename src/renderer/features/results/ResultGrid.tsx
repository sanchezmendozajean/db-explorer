import { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from 'react';
import DataEditor, { CompactSelection, GridCellKind, GridColumnIcon } from '@glideapps/glide-data-grid';
import type { GridCell, GridColumn, GridSelection, Item, SpriteMap, Theme } from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import type { LogicalType, ResultColumn } from '@shared/query';
import { showContextMenu } from '../../components/ContextMenuHost';
import type { MenuEntry } from '../../components/menu-types';
import { SEPARATOR } from '../../components/menu-types';
import { es } from '../../i18n/es';
import { notAvailable } from '../../app/app-commands';
import { useSettingsStore } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import type { CopySelection, CopySource } from './copy';
import type { ResultSet } from './results-store';
import { useResultsStore } from './results-store';
import { formatCell, isNumericType } from './format';
import { canvasMeasure, contentWidth, MIN_COLUMN_WIDTH } from './column-width';
import { visibleColumns, visibleRows } from './view';

const HEADER_ICON: Partial<Record<LogicalType, string>> = {
  integer: GridColumnIcon.HeaderNumber,
  decimal: GridColumnIcon.HeaderNumber,
  float: GridColumnIcon.HeaderNumber,
  text: GridColumnIcon.HeaderString,
  uuid: GridColumnIcon.HeaderString,
  date: GridColumnIcon.HeaderDate,
  datetime: GridColumnIcon.HeaderDate,
  datetimetz: GridColumnIcon.HeaderDate,
  time: GridColumnIcon.HeaderTime,
  boolean: GridColumnIcon.HeaderBoolean,
  json: GridColumnIcon.HeaderCode,
  binary: GridColumnIcon.HeaderArray,
};

/** Íconos propios de cabecera: llave de PK y botón de orden ▲▼ (specs/04 §10). */
function headerIcons(warning: string): SpriteMap {
  const svg = (body: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">${body}</svg>`;
  return {
    pk: () =>
      svg(
        `<g fill="none" stroke="${warning}" stroke-width="1.6"><circle cx="7" cy="10" r="3.2"/><path d="M10.2 10H17M14.5 10v3M16.5 10v2.2"/></g>`,
      ),
    sortNone: ({ fgColor }) =>
      svg(`<path fill="${fgColor}" opacity=".7" d="M10 4l3.5 4.5h-7zM10 16l-3.5-4.5h7z"/>`),
    sortAsc: ({ fgColor }) => svg(`<path fill="${fgColor}" d="M10 5l4.5 6h-9z"/>`),
    sortDesc: ({ fgColor }) => svg(`<path fill="${fgColor}" d="M10 15l-4.5-6h9z"/>`),
  };
}

function cssVar(style: CSSStyleDeclaration, name: string): string {
  return style.getPropertyValue(name).trim();
}

/** Tema de Glide a partir de los tokens de specs/04 (cambia con el tema de la app). */
function gridTheme(fontSize: number): Partial<Theme> {
  const st = getComputedStyle(document.documentElement);
  return {
    accentColor: cssVar(st, '--border-focus'),
    accentFg: cssVar(st, '--accent-fg'),
    accentLight: cssVar(st, '--bg-selection'),
    textDark: cssVar(st, '--fg'),
    textMedium: cssVar(st, '--fg-muted'),
    textLight: cssVar(st, '--fg-disabled'),
    textBubble: cssVar(st, '--fg'),
    bgIconHeader: cssVar(st, '--fg-muted'),
    fgIconHeader: cssVar(st, '--bg-grid-header'),
    textHeader: cssVar(st, '--fg'),
    textHeaderSelected: cssVar(st, '--fg'),
    bgCell: cssVar(st, '--bg-editor'),
    bgCellMedium: cssVar(st, '--bg-grid-row-alt'),
    bgHeader: cssVar(st, '--bg-grid-header'),
    bgHeaderHasFocus: cssVar(st, '--bg-selection-inactive'),
    bgHeaderHovered: cssVar(st, '--bg-hover'),
    bgBubble: cssVar(st, '--bg-input'),
    bgBubbleSelected: cssVar(st, '--bg-selection'),
    bgSearchResult: cssVar(st, '--bg-cell-edited'),
    borderColor: cssVar(st, '--border'),
    horizontalBorderColor: cssVar(st, '--border'),
    headerBottomBorderColor: cssVar(st, '--border'),
    drilldownBorder: cssVar(st, '--border'),
    linkColor: cssVar(st, '--link'),
    fontFamily: GRID_FONT,
    baseFontStyle: `${fontSize}px`,
    headerFontStyle: `600 ${fontSize}px`,
    markerFontStyle: `${fontSize - 1}px`,
    editorFontSize: `${fontSize}px`,
    cellHorizontalPadding: 8,
    cellVerticalPadding: 3,
    headerIconSize: 16,
    lineHeight: 1.4,
  };
}

const GRID_FONT = "'Cascadia Code', Consolas, 'Courier New', monospace";

const EMPTY_SELECTION: GridSelection = { rows: CompactSelection.empty(), columns: CompactSelection.empty() };

/** Acciones que el panel invoca sobre la grilla (copiar, visor de valor). */
export interface ResultGridHandle {
  copySelection: (headers: boolean) => void;
}

interface Props {
  tabId: string;
  result: ResultSet;
  onCopy: (sel: CopySelection, source: CopySource, headers: boolean) => void;
  onViewValue: (value: { column: ResultColumn; value: unknown }) => void;
  onSelectionStats: (stats: SelectionStats | null) => void;
}

export interface SelectionStats {
  sum: number;
  avg: number;
  min: number;
  max: number;
}

function toCopySelection(sel: GridSelection): CopySelection {
  const rects = sel.current ? [sel.current.range, ...sel.current.rangeStack] : [];
  return { rects, rows: sel.rows.toArray(), columns: sel.columns.toArray() };
}

/**
 * Grilla de resultados con Glide Data Grid (D4): canvas, virtualizada,
 * selección de celdas/filas/columnas, orden y copia en TSV.
 */
export const ResultGrid = forwardRef<ResultGridHandle, Props>(function ResultGrid(
  { tabId, result, onCopy, onViewValue, onSelectionStats },
  ref,
) {
  const settings = useSettingsStore((s) => s.settings);
  const theme = useUiStore((s) => s.effectiveTheme);
  const updateView = useResultsStore((s) => s.updateView);
  const [selection, setSelection] = useState<GridSelection>(EMPTY_SELECTION);
  const { columns, rows, view, version } = result;

  const cols = useMemo(() => visibleColumns(columns, view), [columns, view]);
  // `version` cambia al llegar filas: se recalcula el orden/filtro sobre lo cargado.
  const order = useMemo(() => visibleRows(rows, columns, view), [rows, columns, view, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowCount = order ? order.length : rows.length;

  const gridTheme_ = useMemo(() => gridTheme(settings['results.fontSize']), [settings, theme]); // eslint-disable-line react-hooks/exhaustive-deps
  // `theme`: los colores se leen de las variables CSS, que cambian con el tema.
  const icons = useMemo(
    () => headerIcons(getComputedStyle(document.documentElement).getPropertyValue('--warning').trim()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme],
  );

  // Ancho inicial según el contenido de las primeras filas: se calcula al llegar el primer lote
  // y no cambia con los siguientes (la columna no "salta" mientras se cargan filas).
  const fontSize = settings['results.fontSize'];
  const measure = useMemo(() => canvasMeasure(GRID_FONT, fontSize), [fontSize]);
  const hasRows = rows.length > 0;
  const autoWidths = useMemo(
    () =>
      columns.map((column, i) =>
        contentWidth(
          column,
          i,
          rows,
          (value, col) =>
            value === null ? settings['format.null'] : formatCell(value, col.logicalType, settings),
          measure,
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, hasRows, measure],
  );

  const gridColumns = useMemo<GridColumn[]>(
    () =>
      cols.map((c) => {
        const column = columns[c]!;
        const sorted = view.sort?.column === c ? view.sort.dir : null;
        return {
          id: String(c),
          title: column.name,
          width: view.widths[c] ?? autoWidths[c] ?? MIN_COLUMN_WIDTH,
          icon: column.isPk ? 'pk' : (HEADER_ICON[column.logicalType] ?? GridColumnIcon.HeaderString),
          hasMenu: true,
          menuIcon: sorted === 'asc' ? 'sortAsc' : sorted === 'desc' ? 'sortDesc' : 'sortNone',
          indicatorIcon: sorted === 'asc' ? 'sortAsc' : sorted === 'desc' ? 'sortDesc' : undefined,
        };
      }),
    [cols, columns, view, autoWidths],
  );

  const source = useMemo<CopySource>(
    () => ({
      rowCount,
      columnCount: cols.length,
      header: (c) => columns[cols[c]!]!.name,
      value: (r, c) => rows[order ? order[r]! : r]?.[cols[c]!] ?? null,
    }),
    [rowCount, cols, columns, rows, order],
  );

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const c = cols[col]!;
      const column = columns[c]!;
      const value = rows[order ? order[row]! : row]?.[c] ?? null;
      if (value === null) {
        return {
          kind: GridCellKind.Text,
          data: '',
          displayData: settings['format.null'],
          allowOverlay: false,
          readonly: true,
          contentAlign: isNumericType(column.logicalType) ? 'right' : 'left',
          themeOverride: {
            textDark: gridTheme_.textLight,
            baseFontStyle: `italic ${settings['results.fontSize']}px`,
          },
        };
      }
      if (typeof value === 'boolean' && settings['format.boolean'] === 'checkbox') {
        return { kind: GridCellKind.Boolean, data: value, allowOverlay: false, readonly: true };
      }
      return {
        kind: GridCellKind.Text,
        data: String(value),
        displayData: formatCell(value, column.logicalType, settings),
        allowOverlay: false,
        readonly: true,
        contentAlign: isNumericType(column.logicalType)
          ? 'right'
          : column.logicalType === 'boolean'
            ? 'center'
            : 'left',
      };
    },
    // `version`: las filas se agregan en el mismo arreglo; hay que redibujar.
    [cols, columns, rows, order, settings, gridTheme_, version], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const copySelection = (headers: boolean): void => onCopy(toCopySelection(selection), source, headers);
  useImperativeHandle(ref, () => ({ copySelection }));

  const updateSelection = (sel: GridSelection): void => {
    setSelection(sel);
    onSelectionStats(
      selectionStats(
        toCopySelection(sel),
        source,
        cols.map((c) => columns[c]!),
      ),
    );
  };

  const cycleSort = (col: number): void => {
    const c = cols[col]!;
    const current = view.sort?.column === c ? view.sort.dir : null;
    const next = current === null ? 'asc' : current === 'asc' ? 'desc' : null;
    updateView(tabId, result.id, { sort: next ? { column: c, dir: next } : null });
  };

  const valueAt = (cell: Item): { column: ResultColumn; value: unknown } => ({
    column: columns[cols[cell[0]]!]!,
    value: source.value(cell[1], cell[0]),
  });

  const cellMenu = (cell: Item): MenuEntry[] => {
    const c = es.results.cell;
    const pending = (label: string): MenuEntry => ({
      type: 'item',
      id: label,
      label,
      run: () => notAvailable(label),
    });
    return [
      { type: 'item', id: 'copy', label: c.copy, keybinding: 'Ctrl+C', run: () => copySelection(false) },
      {
        type: 'item',
        id: 'copyh',
        label: c.copyWithHeaders,
        keybinding: 'Ctrl+Shift+C',
        run: () => copySelection(true),
      },
      // Copiar como, pegar, establecer NULL, filtrar por valor y formato de columna: hito M7.
      {
        type: 'submenu',
        id: 'copyAs',
        label: c.copyAs,
        entries: ['CSV', 'TSV', 'JSON', 'INSERT', es.results.inList].map((l) => pending(l)),
      },
      {
        type: 'item',
        id: 'paste',
        label: c.paste,
        keybinding: 'Ctrl+V',
        disabled: true,
        run: () => undefined,
      },
      SEPARATOR,
      { type: 'item', id: 'null', label: c.setNull, disabled: true, run: () => undefined },
      {
        type: 'item',
        id: 'view',
        label: c.viewValue,
        keybinding: 'Ctrl+Shift+Enter',
        run: () => onViewValue(valueAt(cell)),
      },
      SEPARATOR,
      pending(c.filterByValue),
      pending(c.excludeValue),
      SEPARATOR,
      { type: 'item', id: 'format', label: c.columnFormat, disabled: true, run: () => undefined },
      {
        type: 'item',
        id: 'hide',
        label: c.hideColumn,
        disabled: cols.length <= 1,
        run: () => updateView(tabId, result.id, { hidden: [...view.hidden, cols[cell[0]]!] }),
      },
      ...(view.hidden.length > 0
        ? [
            {
              type: 'item' as const,
              id: 'show',
              label: es.results.showHidden(view.hidden.length),
              run: () => updateView(tabId, result.id, { hidden: [] }),
            },
          ]
        : []),
    ];
  };

  return (
    <div
      className="result-grid"
      data-testid="results-grid"
      data-columns={cols.map((c) => columns[c]!.name).join(',')}
      data-column-widths={gridColumns.map((c) => Math.round('width' in c ? c.width : 0)).join(',')}
      onKeyDownCapture={(e) => {
        const key = e.key.toLowerCase();
        if (e.ctrlKey && !e.altKey && key === 'c') {
          e.preventDefault();
          e.stopPropagation();
          copySelection(e.shiftKey);
        } else if (e.ctrlKey && e.shiftKey && key === 'enter' && selection.current) {
          e.preventDefault();
          e.stopPropagation();
          onViewValue(valueAt(selection.current.cell));
        }
      }}
    >
      <DataEditor
        columns={gridColumns}
        rows={rowCount}
        getCellContent={getCellContent}
        gridSelection={selection}
        onGridSelectionChange={updateSelection}
        rowMarkers={{ kind: 'clickable-number', width: 48, headerAlwaysVisible: true }}
        rowSelect="multi"
        columnSelect="multi"
        rangeSelect="multi-rect"
        rowSelectionMode="auto"
        rangeSelectionBlending="mixed"
        columnSelectionBlending="mixed"
        rowSelectionBlending="mixed"
        keybindings={{
          copy: false,
          cut: false,
          paste: false,
          search: false,
          delete: false,
          clear: false,
          downFill: false,
          rightFill: false,
        }}
        theme={gridTheme_}
        getRowThemeOverride={
          settings['results.alternateRows']
            ? (row) => (row % 2 === 1 ? { bgCell: gridTheme_.bgCellMedium } : undefined)
            : undefined
        }
        headerIcons={icons}
        onHeaderMenuClick={cycleSort}
        onColumnResize={(_column, size, colIndex) =>
          updateView(tabId, result.id, { widths: { ...view.widths, [cols[colIndex]!]: size } })
        }
        onCellContextMenu={(cell, event) => {
          event.preventDefault();
          if (cell[0] < 0) return;
          // Clic derecho fuera de la selección: primero se selecciona esa celda (specs/04 §10).
          if (!isCellSelected(selection, cell)) {
            updateSelection({
              current: { cell, range: { x: cell[0], y: cell[1], width: 1, height: 1 }, rangeStack: [] },
              rows: CompactSelection.empty(),
              columns: CompactSelection.empty(),
            });
          }
          showContextMenu(
            {
              clientX: event.bounds.x + event.localEventX,
              clientY: event.bounds.y + event.localEventY,
              preventDefault: () => undefined,
            },
            cellMenu(cell),
          );
        }}
        rowHeight={24}
        headerHeight={26}
        smoothScrollX
        smoothScrollY
        width="100%"
        height="100%"
      />
    </div>
  );
});

function isCellSelected(sel: GridSelection, [col, row]: Item): boolean {
  if (sel.rows.hasIndex(row) || sel.columns.hasIndex(col)) return true;
  const rects = sel.current ? [sel.current.range, ...sel.current.rangeStack] : [];
  return rects.some((r) => col >= r.x && col < r.x + r.width && row >= r.y && row < r.y + r.height);
}

/** Máximo de celdas para calcular suma/promedio de la selección sin frenar la UI. */
const STATS_LIMIT = 100_000;

/** Suma, promedio, mínimo y máximo de las celdas numéricas seleccionadas (como Excel). */
function selectionStats(
  sel: CopySelection,
  source: CopySource,
  columns: ResultColumn[],
): SelectionStats | null {
  const numericCols = new Set(
    columns.map((c, i) => (isNumericType(c.logicalType) ? i : -1)).filter((i) => i >= 0),
  );
  if (numericCols.size === 0) return null;
  const cells: [number, number][] = [];
  const add = (r: number, c: number): boolean => {
    if (numericCols.has(c)) cells.push([r, c]);
    return cells.length <= STATS_LIMIT;
  };
  for (const rect of sel.rects) {
    for (let r = rect.y; r < rect.y + rect.height; r++)
      for (let c = rect.x; c < rect.x + rect.width; c++) if (!add(r, c)) return null;
  }
  for (const r of sel.rows) for (let c = 0; c < source.columnCount; c++) if (!add(r, c)) return null;
  for (const c of sel.columns) for (let r = 0; r < source.rowCount; r++) if (!add(r, c)) return null;
  const seen = new Set<string>();
  let sum = 0;
  let count = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const [r, c] of cells) {
    const key = `${r}:${c}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const v = source.value(r, c);
    if (v === null || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    sum += n;
    count++;
    min = Math.min(min, n);
    max = Math.max(max, n);
  }
  // Una sola celda no muestra resumen.
  return count > 1 ? { sum, avg: sum / count, min, max } : null;
}
