import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import DataEditor, { CompactSelection, GridCellKind, GridColumnIcon } from '@glideapps/glide-data-grid';
import type {
  DataEditorRef,
  EditableGridCell,
  GridCell,
  GridColumn,
  GridMouseEventArgs,
  GridSelection,
  Item,
  SpriteMap,
  Theme,
} from '@glideapps/glide-data-grid';
import '@glideapps/glide-data-grid/dist/index.css';
import type { Engine } from '@shared/connection';
import type { CellValue, LogicalType, ResultColumn } from '@shared/query';
import type { ColumnFormat } from '@shared/settings';
import { csvEncoder, encodeAll, inList, insertEncoder, jsonEncoder, markdownEncoder } from '@shared/export';
import { qualifiedName, quoteIdent } from '@shared/sql-quote';
import { showContextMenu } from '../../components/ContextMenuHost';
import type { MenuEntry } from '../../components/menu-types';
import { SEPARATOR } from '../../components/menu-types';
import { es } from '../../i18n/es';
import { setting, useSettingsStore } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import type { CopySelection, CopySource } from './copy';
import { selectionBounds, tsvField } from './copy';
import type { RowRef } from './edit-state';
import { cellValue, isCellEdited, rowKey, setCells } from './edit-state';
import type { GridHandle } from './grid-edit';
import { editPending, isEditableColumn, setActiveGrid } from './grid-edit';
import {
  addRow,
  clearSelectedCells,
  deleteSelectedRows,
  duplicateSelectedRows,
  pasteIntoGrid,
  setSelectedNull,
} from './grid-commands';
import type { ResultSet } from './results-store';
import { useResultsStore } from './results-store';
import { formatCell, isNumericType, withColumnFormat } from './format';
import type { FormatSettings } from './format';
import { canvasMeasure, contentWidth, MIN_COLUMN_WIDTH } from './column-width';
import { columnFormatKey, columnFormats, setColumnFormat } from './column-format';
import { ColumnFormatPopover } from './ColumnFormatPopover';
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
function gridTheme(fontSize: number): Partial<Theme> & Record<string, string | number> {
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
    // Colores de cambios pendientes (specs/04 §2); no son claves de Glide.
    cellEdited: cssVar(st, '--bg-cell-edited'),
    rowDeleted: cssVar(st, '--bg-row-deleted'),
    rowInserted: cssVar(st, '--bg-row-inserted'),
    error: cssVar(st, '--error'),
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
  engine?: Engine;
  onCopy: (sel: CopySelection, source: CopySource, headers: boolean) => void;
  /** Copiar como (CSV, JSON, INSERT…): texto ya armado. */
  onCopyText: (text: string) => void;
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
 * selección de celdas/filas/columnas, orden, copia en TSV y edición con
 * cambios pendientes (specs/06 §Edición de datos).
 */
export const ResultGrid = forwardRef<ResultGridHandle, Props>(function ResultGrid(
  { tabId, result, engine, onCopy, onCopyText, onViewValue, onSelectionStats },
  ref,
) {
  const settings = useSettingsStore((s) => s.settings);
  const theme = useUiStore((s) => s.effectiveTheme);
  const updateView = useResultsStore((s) => s.updateView);
  const [selection, setSelection] = useState<GridSelection>(EMPTY_SELECTION);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const [formatting, setFormatting] = useState<{ column: number; x: number; y: number } | null>(null);
  const editorRef = useRef<DataEditorRef>(null);
  const { columns, rows, view, version, pending, editable } = result;

  const cols = useMemo(() => visibleColumns(columns, view), [columns, view]);
  // `version` cambia al llegar filas: se recalcula el orden/filtro sobre lo cargado.
  const order = useMemo(() => visibleRows(rows, columns, view), [rows, columns, view, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const baseCount = order ? order.length : rows.length;
  const rowCount = baseCount + pending.inserted.length;

  const refAt = useCallback(
    (displayRow: number): RowRef | null => {
      if (displayRow < 0) return null;
      if (displayRow < baseCount) return { kind: 'row', index: order ? order[displayRow]! : displayRow };
      const inserted = pending.inserted[displayRow - baseCount];
      return inserted ? { kind: 'new', id: inserted.id } : null;
    },
    [baseCount, order, pending.inserted],
  );

  const gridTheme_ = useMemo(() => gridTheme(settings['results.fontSize']), [settings, theme]); // eslint-disable-line react-hooks/exhaustive-deps
  // `theme`: los colores se leen de las variables CSS, que cambian con el tema.
  const icons = useMemo(
    () => headerIcons(getComputedStyle(document.documentElement).getPropertyValue('--warning').trim()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme],
  );

  // Formato de cada columna (el de la vista o el recordado en settings) sobre el global.
  const formats = useMemo(
    () => columnFormats(tabId, result),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabId, columns, view.formats, settings['format.columns']],
  );
  const colSettings = useMemo<FormatSettings[]>(
    () => formats.map((f) => withColumnFormat(settings, f)),
    [formats, settings],
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
            value === null ? settings['format.null'] : formatCell(value, col.logicalType, colSettings[i]!),
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
      value: (r, c) => {
        const at = refAt(r);
        return at ? (cellValue(rows, pending, at, cols[c]!) ?? null) : null;
      },
    }),
    [rowCount, cols, columns, rows, pending, refAt],
  );

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const c = cols[col]!;
      const column = columns[c]!;
      const at = refAt(row) ?? { kind: 'row', index: -1 };
      const value = cellValue(rows, pending, at, c);
      const deleted = at.kind === 'row' && pending.deleted.includes(at.index);
      const canEdit = !deleted && isEditableColumn(result, c);
      const s = colSettings[c]!;
      const align = formats[c]?.align;
      const contentAlign =
        align ??
        (isNumericType(column.logicalType) ? 'right' : column.logicalType === 'boolean' ? 'center' : 'left');
      const override: Partial<Theme> = {};
      if (deleted) override.bgCell = gridTheme_['rowDeleted'] as string;
      else if (at.kind === 'new') override.bgCell = gridTheme_['rowInserted'] as string;
      else if (isCellEdited(pending, at, c)) override.bgCell = gridTheme_['cellEdited'] as string;
      if (pending.errors[rowKey(at)]) override.textDark = gridTheme_['error'] as string;

      if (value === undefined || value === null) {
        return {
          kind: GridCellKind.Text,
          data: '',
          displayData: value === undefined ? 'DEFAULT' : s['format.null'],
          allowOverlay: canEdit,
          readonly: !canEdit,
          contentAlign,
          themeOverride: {
            ...override,
            textDark: override.textDark ?? gridTheme_.textLight,
            baseFontStyle: `italic ${settings['results.fontSize']}px`,
          },
        };
      }
      if (typeof value === 'boolean' && s['format.boolean'] === 'checkbox') {
        return {
          kind: GridCellKind.Boolean,
          data: value,
          allowOverlay: false,
          readonly: !canEdit,
          themeOverride: override,
        };
      }
      return {
        kind: GridCellKind.Text,
        data: String(value),
        displayData: formatCell(value, column.logicalType, s),
        allowOverlay: canEdit,
        readonly: !canEdit,
        contentAlign,
        themeOverride: override,
      };
    },
    // `version`: las filas se agregan en el mismo arreglo; hay que redibujar.
    [cols, columns, rows, pending, refAt, result, colSettings, formats, settings, gridTheme_, version], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const onCellEdited = ([col, row]: Item, cell: EditableGridCell): void => {
    const at = refAt(row);
    const c = cols[col];
    if (!at || c === undefined || !isEditableColumn(result, c)) return;
    const previous = cellValue(rows, pending, at, c);
    let value: CellValue;
    if (cell.kind === GridCellKind.Boolean) value = cell.data === true;
    else if (cell.kind === GridCellKind.Text) {
      // Abrir y cerrar el editor de una celda NULL sin escribir no la convierte en texto vacío.
      if (cell.data === '' && (previous === null || previous === undefined)) return;
      value = cell.data;
    } else return;
    editPending(tabId, result.id, (p, r) => setCells(r.rows, p, [{ ref: at, column: c, value }]));
  };

  const copySelection = (headers: boolean): void => onCopy(toCopySelection(selection), source, headers);
  useImperativeHandle(ref, () => ({ copySelection }));

  // Estado actual para los atajos de edición (se leen al ejecutar el comando).
  const latest = useRef({ selection, refAt, cols });
  useLayoutEffect(() => {
    latest.current = { selection, refAt, cols };
  });
  const handle = useMemo<GridHandle>(
    () => ({
      tabId,
      resultId: result.id,
      selectedRows: () => {
        const { selection: sel, refAt: at } = latest.current;
        const indices = new Set<number>(sel.rows.toArray());
        for (const r of toCopySelection(sel).rects) for (let y = r.y; y < r.y + r.height; y++) indices.add(y);
        return [...indices]
          .sort((a, b) => a - b)
          .flatMap((i) => {
            const x = at(i);
            return x ? [x] : [];
          });
      },
      selectedCells: () => {
        const { selection: sel, refAt: at, cols: visible } = latest.current;
        const bounds = selectionBounds(toCopySelection(sel), source);
        const isSelected = (row: number, col: number): boolean =>
          sel.rows.hasIndex(row) || sel.columns.hasIndex(col) || isCellSelected(sel, [col, row]);
        const out: { ref: RowRef; column: number }[] = [];
        for (const row of bounds.rows) {
          const x = at(row);
          if (!x) continue;
          for (const col of bounds.columns)
            if (isSelected(row, col)) out.push({ ref: x, column: visible[col]! });
        }
        return out;
      },
      focusedCell: () => {
        const cell = latest.current.selection.current?.cell;
        return cell ? { displayRow: cell[1], column: cell[0] } : null;
      },
      refAt: (row) => latest.current.refAt(row),
      visibleColumns: () => latest.current.cols,
      focusCell: (row, col) => {
        setSelection({
          current: { cell: [col, row], range: { x: col, y: row, width: 1, height: 1 }, rangeStack: [] },
          rows: CompactSelection.empty(),
          columns: CompactSelection.empty(),
        });
        editorRef.current?.scrollTo(col, row);
        editorRef.current?.focus();
      },
    }),

    [tabId, result.id, source],
  );

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

  /** Filas y columnas (visibles) de la selección con sus valores, para "Copiar como". */
  const selectedMatrix = (): { columns: ResultColumn[]; rows: CellValue[][]; visibleCols: number[] } => {
    const bounds = selectionBounds(toCopySelection(selection), source);
    return {
      columns: bounds.columns.map((c) => columns[cols[c]!]!),
      rows: bounds.rows.map((r) => bounds.columns.map((c) => source.value(r, c))),
      visibleCols: bounds.columns,
    };
  };

  const insertTable = (): string => {
    const e = engine ?? 'postgres';
    if (editable) {
      return qualifiedName(e, {
        schema: e === 'sqlite' ? undefined : editable.table.schema,
        name: editable.table.name,
      });
    }
    return quoteIdent(e, result.title);
  };

  const copyAs = (kind: 'csv' | 'tsv' | 'json' | 'markdown' | 'insert' | 'in' | 'formatted'): void => {
    const m = selectedMatrix();
    if (m.rows.length === 0) return;
    const nullAs = setting('results.copy.nullAs');
    let text: string;
    switch (kind) {
      case 'csv':
        text = encodeAll(csvEncoder(m.columns, { separator: ',', header: true, nullAs }), m.rows);
        break;
      case 'tsv':
        text = encodeAll(csvEncoder(m.columns, { separator: '\t', header: true, nullAs }), m.rows);
        break;
      case 'json':
        text = encodeAll(jsonEncoder(m.columns, { pretty: true }), m.rows);
        break;
      case 'markdown':
        text = encodeAll(markdownEncoder(m.columns, { nullAs: settings['format.null'] }), m.rows);
        break;
      case 'insert':
        text = encodeAll(
          insertEncoder(m.columns, { engine: engine ?? 'postgres', table: insertTable() }),
          m.rows,
        );
        break;
      case 'in':
        text = inList(
          engine ?? 'postgres',
          m.columns[0]!,
          m.rows.map((r) => r[0] ?? null),
        );
        break;
      case 'formatted': {
        const header = m.columns.map((c) => tsvField(c.name)).join('\t');
        const lines = m.rows.map((r) =>
          r
            .map((v, i) => {
              const c = cols[m.visibleCols[i]!]!;
              return tsvField(v === null ? nullAs : formatCell(v, columns[c]!.logicalType, colSettings[c]!));
            })
            .join('\t'),
        );
        text = `${[header, ...lines].join('\r\n')}\r\n`;
        break;
      }
    }
    onCopyText(text);
  };

  const cellMenu = (cell: Item, clientX: number, clientY: number): MenuEntry[] => {
    const c = es.results.cell;
    const column = cols[cell[0]]!;
    const at = refAt(cell[1]);
    const canEdit = !!editable && isEditableColumn(result, column);
    const value = source.value(cell[1], cell[0]);
    const item = (id: string, label: string, run: () => void, extra: Partial<MenuEntry> = {}): MenuEntry =>
      ({ type: 'item', id, label, run, ...extra }) as MenuEntry;
    const filter = (exclude: boolean): void =>
      updateView(tabId, result.id, {
        valueFilters: [...view.valueFilters, { column, value, exclude }],
      });
    const entries: MenuEntry[] = [
      item('copy', c.copy, () => copySelection(false), { keybinding: 'Ctrl+C' }),
      item('copyh', c.copyWithHeaders, () => copySelection(true), { keybinding: 'Ctrl+Shift+C' }),
      {
        type: 'submenu',
        id: 'copyAs',
        label: c.copyAs,
        entries: [
          item('csv', 'CSV', () => copyAs('csv')),
          item('tsv', 'TSV', () => copyAs('tsv')),
          item('json', 'JSON', () => copyAs('json')),
          item('md', 'Markdown', () => copyAs('markdown')),
          item('insert', 'INSERT', () => copyAs('insert')),
          item('in', es.results.inList, () => copyAs('in')),
          SEPARATOR,
          item('formatted', c.copyFormatted, () => copyAs('formatted')),
        ],
      },
      item('paste', c.paste, () => void pasteIntoGrid(), { keybinding: 'Ctrl+V', disabled: !editable }),
      SEPARATOR,
      item('null', c.setNull, setSelectedNull, { keybinding: 'Shift+Supr', disabled: !canEdit }),
      item('view', c.viewValue, () => onViewValue(valueAt(cell)), { keybinding: 'Ctrl+Shift+Enter' }),
      SEPARATOR,
      item('filter', c.filterByValue, () => filter(false)),
      item('exclude', c.excludeValue, () => filter(true)),
      ...(view.valueFilters.length > 0
        ? [item('unfilter', c.clearValueFilters, () => updateView(tabId, result.id, { valueFilters: [] }))]
        : []),
      SEPARATOR,
      item('format', c.columnFormat, () => setFormatting({ column, x: clientX, y: clientY })),
      item('hide', c.hideColumn, () => updateView(tabId, result.id, { hidden: [...view.hidden, column] }), {
        disabled: cols.length <= 1,
      }),
      ...(view.hidden.length > 0
        ? [
            item('show', es.results.showHidden(view.hidden.length), () =>
              updateView(tabId, result.id, { hidden: [] }),
            ),
          ]
        : []),
      item('autosize', c.autosize, () =>
        updateView(tabId, result.id, {
          widths: Object.fromEntries(Object.entries(view.widths).filter(([k]) => Number(k) !== column)),
        }),
      ),
    ];
    if (editable) {
      entries.push(
        SEPARATOR,
        item('add', es.results.addRow, addRow, { keybinding: 'Alt+Insert' }),
        item('dup', c.duplicateRow, duplicateSelectedRows, { disabled: !at }),
        item('del', es.results.deleteRows, deleteSelectedRows, { keybinding: 'Ctrl+Supr', disabled: !at }),
      );
    }
    return entries;
  };

  const formattingColumn = formatting ? columns[formatting.column] : undefined;
  const formatKey = formatting ? columnFormatKey(tabId, result, formatting.column) : null;
  const focused = selection.current?.cell;

  return (
    <div
      className="result-grid"
      data-testid="results-grid"
      data-focus-context="gridFocus"
      data-columns={cols.map((c) => columns[c]!.name).join(',')}
      data-column-widths={gridColumns.map((c) => Math.round('width' in c ? c.width : 0)).join(',')}
      data-editable={editable ? 'true' : 'false'}
      data-result-id={result.id}
      onFocusCapture={() => setActiveGrid(handle)}
      onMouseDownCapture={() => setActiveGrid(handle)}
      onKeyDownCapture={(e) => {
        const key = e.key.toLowerCase();
        // Con el editor de celda abierto, las teclas son del editor.
        if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
        if (e.ctrlKey && !e.altKey && key === 'c') {
          e.preventDefault();
          e.stopPropagation();
          copySelection(e.shiftKey);
        } else if (e.ctrlKey && e.shiftKey && key === 'enter' && selection.current) {
          e.preventDefault();
          e.stopPropagation();
          onViewValue(valueAt(selection.current.cell));
        } else if (key === 'delete' && editable && !e.ctrlKey) {
          // Supr / Shift+Supr también llegan por los atajos (gridFocus); aquí por si Glide los consume.
          e.preventDefault();
          if (e.shiftKey) setSelectedNull();
          else clearSelectedCells();
        }
      }}
    >
      <DataEditor
        ref={editorRef}
        columns={gridColumns}
        rows={rowCount}
        getCellContent={getCellContent}
        onCellEdited={onCellEdited}
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
        onItemHovered={(args: GridMouseEventArgs) => {
          if (args.kind !== 'cell') {
            if (hover) setHover(null);
            return;
          }
          const at = refAt(args.location[1]);
          const text = at ? pending.errors[rowKey(at)] : undefined;
          if (!text) {
            if (hover) setHover(null);
            return;
          }
          setHover({ x: args.bounds.x, y: args.bounds.y + args.bounds.height + 2, text });
        }}
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
          const clientX = event.bounds.x + event.localEventX;
          const clientY = event.bounds.y + event.localEventY;
          showContextMenu(
            { clientX, clientY, preventDefault: () => undefined },
            cellMenu(cell, clientX, clientY),
          );
        }}
        rowHeight={24}
        headerHeight={26}
        smoothScrollX
        smoothScrollY
        width="100%"
        height="100%"
      />
      {hover && (
        <div className="grid-tooltip" role="tooltip" style={{ left: hover.x, top: hover.y }}>
          {hover.text}
        </div>
      )}
      {formatting && formattingColumn && (
        <ColumnFormatPopover
          column={formattingColumn}
          sample={focused ? (source.value(focused[1], focused[0]) ?? null) : null}
          initial={formats[formatting.column] as ColumnFormat | undefined}
          rememberLabel={formatKey ? `${formatKey.split('/').at(-2)}.${formatKey.split('/').at(-1)}` : null}
          remembered={!!formatKey && !!settings['format.columns'][formatKey]}
          x={formatting.x}
          y={formatting.y}
          onClose={() => setFormatting(null)}
          onApply={(format, remember) => {
            void setColumnFormat(tabId, result.id, formatting.column, format, remember);
            setFormatting(null);
          }}
        />
      )}
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
