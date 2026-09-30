import { useMemo, useState } from 'react';
import { Codicon } from '../../components/Codicon';
import { IconButton } from '../../components/Button';
import { Dropdown } from '../../components/Dropdown';
import { Select, TextInput } from '../../components/Inputs';
import { showContextMenu } from '../../components/ContextMenuHost';
import type { MenuEntry } from '../../components/menu-types';
import { SEPARATOR } from '../../components/menu-types';
import { es } from '../../i18n/es';
import { notAvailable } from '../../app/app-commands';
import type { LogicalType, SampleColumn } from '../../sample/sample-data';
import { SAMPLE_RESULT } from '../../sample/sample-data';

type Cell = string | number | boolean | null;

const TYPE_ICON: Record<LogicalType, { icon?: string; text?: string }> = {
  integer: { text: '123' },
  decimal: { text: '123' },
  text: { text: 'abc' },
  datetime: { icon: 'calendar' },
  boolean: { icon: 'check' },
};

function ColumnHeader({ column }: { column: SampleColumn }): React.JSX.Element {
  const t = TYPE_ICON[column.type];
  return (
    <div
      className="grid-header-cell"
      title={`${column.nativeType}\n${SAMPLE_RESULT.title}`}
      style={{ width: column.width }}
    >
      {column.primaryKey ? (
        <Codicon name="key" size={14} color="var(--warning)" />
      ) : t.icon ? (
        <Codicon name={t.icon} size={14} className="grid-type" />
      ) : (
        <span className="grid-type grid-type-text">{t.text}</span>
      )}
      <span>{column.name}</span>
    </div>
  );
}

function renderCell(value: Cell, column: SampleColumn): React.JSX.Element {
  if (value === null) return <span className="grid-null">NULL</span>;
  if (column.type === 'boolean') {
    return (
      <span
        className={['grid-bool', value ? 'is-checked' : ''].join(' ')}
        role="img"
        aria-label={String(value)}
      >
        {value && <Codicon name="check" size={12} />}
      </span>
    );
  }
  return <>{String(value)}</>;
}

function cellEntries(value: Cell): MenuEntry[] {
  const pending = (label: string, keybinding?: string): MenuEntry => ({
    type: 'item',
    id: label,
    label,
    keybinding,
    run: () => notAvailable(label),
  });
  const c = es.results.cell;
  return [
    {
      type: 'item',
      id: 'copy',
      label: c.copy,
      keybinding: 'Ctrl+C',
      run: () => void window.api.app.clipboardWrite({ text: value === null ? '' : String(value) }),
    },
    pending(c.copyWithHeaders, 'Ctrl+Shift+C'),
    {
      type: 'submenu',
      id: 'copyAs',
      label: c.copyAs,
      entries: ['CSV', 'TSV', 'JSON', 'INSERT', 'IN (…) lista'].map((l) => pending(l)),
    },
    pending(c.paste, 'Ctrl+V'),
    SEPARATOR,
    pending(c.setNull),
    pending(c.viewValue, 'Ctrl+Shift+Enter'),
    SEPARATOR,
    pending(c.filterByValue),
    pending(c.excludeValue),
    SEPARATOR,
    { type: 'submenu', id: 'format', label: c.columnFormat, entries: [pending(es.results.viewText)] },
    pending(c.hideColumn),
    pending(c.autosize),
  ];
}

/**
 * Grilla de resultados de maqueta (tabla HTML con datos falsos).
 * Se reemplaza por Glide Data Grid en el hito M3.
 */
export function ResultsGrid({ filter }: { filter: string }): React.JSX.Element {
  const [focus, setFocus] = useState<[number, number]>([0, 3]);
  const columns = SAMPLE_RESULT.columns;
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return SAMPLE_RESULT.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !q || row.some((v) => v !== null && String(v).toLowerCase().includes(q)));
  }, [filter]);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const [r, c] = focus;
    const moves: Record<string, [number, number]> = {
      ArrowDown: [Math.min(rows.length - 1, r + 1), c],
      ArrowUp: [Math.max(0, r - 1), c],
      ArrowRight: [r, Math.min(columns.length - 1, c + 1)],
      ArrowLeft: [r, Math.max(0, c - 1)],
    };
    const next = moves[e.key];
    if (next) {
      e.preventDefault();
      setFocus(next);
    }
  };

  return (
    <div
      className="grid"
      tabIndex={0}
      role="grid"
      aria-rowcount={rows.length}
      onKeyDown={onKeyDown}
      data-testid="results-grid"
    >
      <div className="grid-row grid-header" role="row">
        <div className="grid-rownum" />
        {columns.map((col) => (
          <ColumnHeader key={col.name} column={col} />
        ))}
      </div>
      {rows.map(({ row }, r) => (
        <div key={r} className={['grid-row', r % 2 === 1 ? 'is-alt' : ''].join(' ')} role="row">
          <div className={['grid-rownum', r === focus[0] ? 'is-current' : ''].join(' ')}>{r + 1}</div>
          {columns.map((col, c) => {
            const value = row[c] ?? null;
            const numeric = col.type === 'integer' || col.type === 'decimal';
            const focused = r === focus[0] && c === focus[1];
            return (
              <div
                key={col.name}
                role="gridcell"
                aria-selected={focused}
                className={[
                  'grid-cell',
                  numeric ? 'is-numeric' : '',
                  col.type === 'boolean' ? 'is-center' : '',
                  focused ? 'is-focused' : '',
                ].join(' ')}
                style={{ width: col.width }}
                onMouseDown={() => setFocus([r, c])}
                onContextMenu={(e) => {
                  setFocus([r, c]);
                  showContextMenu(e, cellEntries(value));
                }}
              >
                {renderCell(value, col)}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function ResultsToolbar({
  filter,
  onFilter,
}: {
  filter: string;
  onFilter: (value: string) => void;
}): React.JSX.Element {
  const [view, setView] = useState<'grid' | 'text' | 'record'>('grid');
  const [limit, setLimit] = useState('500');
  const r = es.results;
  const pending = (label: string): MenuEntry => ({
    type: 'item',
    id: label,
    label,
    run: () => notAvailable(label),
  });
  return (
    <div className="results-toolbar">
      <TextInput
        icon="filter"
        className="results-filter"
        placeholder={r.filterPlaceholder}
        aria-label={r.filterPlaceholder}
        value={filter}
        onChange={(e) => onFilter(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onFilter('')}
      />
      <IconButton icon="refresh" label={r.rerun} onClick={() => notAvailable(r.rerun)} />
      <span className="toolbar-separator" />
      <IconButton icon="add" label={r.addRow} onClick={() => notAvailable(r.addRow)} />
      <IconButton icon="trash" label={r.deleteRows} onClick={() => notAvailable(r.deleteRows)} />
      <Dropdown
        className="toolbar-btn"
        entries={[
          pending(r.exportCsv),
          pending(r.exportJson),
          pending(r.exportXlsx),
          pending(r.exportInsert),
          pending(r.exportMarkdown),
        ]}
      >
        <Codicon name="export" size={14} />
        <span>{r.export}</span>
      </Dropdown>
      <div className="segmented" role="radiogroup">
        {(
          [
            ['grid', 'list-flat', r.viewGrid],
            ['text', 'json', r.viewText],
            ['record', 'list-unordered', r.viewRecord],
          ] as const
        ).map(([id, icon, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={view === id}
            className={view === id ? 'is-active' : ''}
            onClick={() => (id === 'grid' ? setView(id) : notAvailable(label))}
          >
            <Codicon name={icon} size={14} />
            {label}
          </button>
        ))}
      </div>
      <div className="toolbar-spacer" />
      <label className="results-limit">
        <span>{r.limit}</span>
        <Select
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          options={[
            { value: '100', label: '100' },
            { value: '500', label: '500' },
            { value: '1000', label: '1000' },
            { value: '5000', label: '5000' },
            { value: 'all', label: r.limitAll },
          ]}
        />
      </label>
    </div>
  );
}

export function ResultsFooter({ rowCount }: { rowCount: number }): React.JSX.Element {
  return (
    <div className="results-footer">
      <span>{es.results.rows(rowCount)}</span>
      <span>{es.units.ms(SAMPLE_RESULT.durationMs)}</span>
      <span>{SAMPLE_RESULT.executedAt}</span>
      <span className="toolbar-spacer" />
      <span>{es.results.summary('45.20', '45.20', '45.20', '45.20')}</span>
    </div>
  );
}
