import { useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { ResultColumn } from '@shared/query';
import { Codicon } from '../../components/Codicon';
import { IconButton } from '../../components/Button';
import { Dropdown } from '../../components/Dropdown';
import { Select, TextInput } from '../../components/Inputs';
import { Tabs } from '../../components/Tabs';
import type { MenuEntry } from '../../components/menu-types';
import { SEPARATOR } from '../../components/menu-types';
import { es } from '../../i18n/es';
import { notAvailable } from '../../app/app-commands';
import { setting, useSettingsStore } from '../../stores/settings-store';
import { showToast } from '../../stores/toast-store';
import { useUiStore } from '../../stores/ui-store';
import type { EditorTab } from '../../stores/workbench-store';
import { askChoice } from '../dialogs/ask';
import { loadMore, rerun, revealPosition } from '../execution/execute';
import type { CopySelection, CopySource } from './copy';
import { selectedCellCount, selectionToTsv, tableToTsv } from './copy';
import { separators } from './format';
import type { ResultGridHandle, SelectionStats } from './ResultGrid';
import { ResultGrid } from './ResultGrid';
import type { MessageEntry, ResultSet } from './results-store';
import { EMPTY_TAB_RESULTS, tabResults, useResultsStore } from './results-store';
import { ValueViewer } from './ValueViewer';
import { visibleColumns, visibleRows } from './view';

/** Confirmación antes de copiar selecciones muy grandes (specs/06). */
const COPY_CONFIRM_CELLS = 100_000;

async function writeClipboard(text: string): Promise<void> {
  const r = await window.api.app.clipboardWrite({ text });
  if (!r.ok) showToast('error', r.error.message);
}

async function copySelection(sel: CopySelection, source: CopySource, headers: boolean): Promise<void> {
  const cells = selectedCellCount(sel, source);
  if (cells === 0) return;
  if (cells > COPY_CONFIRM_CELLS) {
    const answer = await askChoice({
      title: es.results.copyLargeTitle,
      message: es.results.copyLarge(cells),
      buttons: [
        { value: 'copy', label: es.results.cell.copy, variant: 'primary' },
        { value: 'cancel', label: es.dialogs.cancel },
      ],
    });
    if (answer !== 'copy') return;
  }
  await writeClipboard(selectionToTsv(sel, source, { headers, nullAs: setting('results.copy.nullAs') }));
}

/** Panel de resultados (specs/04 §10), asociado a la pestaña SQL activa. */
export function ResultsPanel({ tab }: { tab: EditorTab }): React.JSX.Element {
  const maximized = useUiStore((s) => s.panel.maximized);
  const toggleMaximize = useUiStore((s) => s.toggleMaximizePanel);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const state = useResultsStore((s) => s.byTab[tab.id] ?? EMPTY_TAB_RESULTS);
  const { setActiveView, togglePin } = useResultsStore.getState();
  const [viewer, setViewer] = useState<{ column: ResultColumn; value: unknown } | null>(null);
  const [stats, setStats] = useState<SelectionStats | null>(null);
  const gridRef = useRef<ResultGridHandle>(null);

  const result = state.results.find((r) => r.id === state.activeView);
  const items = [
    ...state.results.map((r) => ({
      id: r.id,
      label: r.title,
      icon: 'table',
      iconColor: 'var(--icon-table)',
      extra: (
        <span
          role="button"
          tabIndex={-1}
          className={['tab-pin', r.pinned ? 'is-pinned' : ''].join(' ')}
          title={r.pinned ? es.results.unpin : es.results.pin}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            togglePin(tab.id, r.id);
          }}
        >
          <Codicon name={r.pinned ? 'pinned' : 'pin'} size={12} />
        </span>
      ),
    })),
    {
      id: 'messages',
      label: es.results.messages,
      icon: state.messages.some((m) => m.kind === 'error') ? 'error' : undefined,
      iconColor: 'var(--error)',
    },
  ];
  const activeId = items.some((i) => i.id === state.activeView) ? state.activeView : 'messages';

  const tabId = tab.id;
  /** "Copiar tabla": todas las filas cargadas y columnas visibles, con orden y filtro (specs/06). */
  const copyTable = async (resultId: string, headers: boolean): Promise<void> => {
    const current = tabResults(tabId).results.find((r) => r.id === resultId);
    if (!current) return;
    const cols = visibleColumns(current.columns, current.view);
    const order = visibleRows(current.rows, current.columns, current.view);
    const source: CopySource = {
      rowCount: order ? order.length : current.rows.length,
      columnCount: cols.length,
      header: (c) => current.columns[cols[c]!]!.name,
      value: (r, c) => current.rows[order ? order[r]! : r]?.[cols[c]!] ?? null,
    };
    await writeClipboard(tableToTsv(source, { headers, nullAs: setting('results.copy.nullAs') }));
    if (current.truncated) {
      showToast('info', es.results.copiedTruncated(source.rowCount), [
        {
          label: es.results.loadAllAndCopy,
          run: () => void loadMore(tabId, resultId, true).then(() => copyTable(resultId, headers)),
        },
      ]);
    }
  };

  const grid = result && (
    <ResultGrid
      key={result.id}
      ref={gridRef}
      tabId={tab.id}
      result={result}
      onCopy={(sel, source, headers) => void copySelection(sel, source, headers)}
      onViewValue={setViewer}
      onSelectionStats={setStats}
    />
  );

  return (
    <section
      className="panel"
      data-focus-context="resultsFocus"
      tabIndex={-1}
      aria-label={es.results.panelLabel}
    >
      <div className="panel-header">
        <Tabs
          items={items}
          activeId={activeId}
          onChange={(id) => setActiveView(tab.id, id)}
          ariaLabel={es.results.tabsLabel}
        />
        <div className="panel-actions">
          <IconButton
            icon={maximized ? 'chevron-down' : 'chevron-up'}
            label={maximized ? es.results.restore : es.results.maximize}
            onClick={toggleMaximize}
          />
          <IconButton icon="close" label={es.results.hide} onClick={togglePanel} />
        </div>
      </div>
      {result ? (
        <>
          <ResultsToolbar tab={tab} result={result} onCopyTable={(h) => void copyTable(result.id, h)} />
          <div className="panel-body results-body">
            {viewer ? (
              <Group id="results-viewer-split" orientation="horizontal" className="split">
                <Panel id="grid" minSize={200}>
                  {grid}
                </Panel>
                <Separator className="sash sash-vertical" />
                <Panel id="viewer" minSize={180} defaultSize={300}>
                  <ValueViewer column={viewer.column} value={viewer.value} onClose={() => setViewer(null)} />
                </Panel>
              </Group>
            ) : (
              grid
            )}
          </div>
          <ResultsFooter tab={tab} result={result} stats={stats} />
        </>
      ) : activeId === 'messages' && state.messages.length > 0 ? (
        <MessagesView tabId={tab.id} messages={state.messages} />
      ) : (
        <div className="panel-body panel-empty">
          <p>{state.running ? es.execution.running : es.results.empty}</p>
        </div>
      )}
    </section>
  );
}

function ResultsToolbar({
  tab,
  result,
  onCopyTable,
}: {
  tab: EditorTab;
  result: ResultSet;
  onCopyTable: (headers: boolean) => void;
}): React.JSX.Element {
  const r = es.results;
  const limit = useResultsStore((s) => (s.byTab[tab.id] ?? EMPTY_TAB_RESULTS).limit);
  const defaultLimit = useSettingsStore((s) => s.settings['results.maxRows']);
  const { updateView, setLimit } = useResultsStore.getState();
  const [filter, setFilter] = useState(result.view.filter);

  // Filtro rápido con un pequeño retardo para no reordenar en cada tecla con muchas filas.
  useEffect(() => {
    const timer = setTimeout(() => updateView(tab.id, result.id, { filter }), 120);
    return () => clearTimeout(timer);
  }, [filter, tab.id, result.id, updateView]);

  const pending = (label: string): MenuEntry => ({
    type: 'item',
    id: label,
    label,
    run: () => notAvailable(label),
  });
  const current = limit ?? defaultLimit;
  const limitOptions = [100, 500, 1000, 5000];
  if (typeof current === 'number' && !limitOptions.includes(current)) limitOptions.push(current);

  return (
    <div className="results-toolbar">
      <TextInput
        icon="filter"
        className="results-filter"
        placeholder={r.filterPlaceholder}
        aria-label={r.filterPlaceholder}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
      />
      <IconButton icon="refresh" label={r.rerun} onClick={() => void rerun(tab.id)} />
      <span className="toolbar-separator" />
      <Dropdown
        className="toolbar-btn"
        testId="export-menu"
        entries={[
          // Exportar a archivo: hito M7.
          pending(r.exportCsv),
          pending(r.exportJson),
          pending(r.exportXlsx),
          pending(r.exportInsert),
          pending(r.exportMarkdown),
          SEPARATOR,
          { type: 'item', id: 'copy-table', label: r.copyTable, run: () => onCopyTable(false) },
          { type: 'item', id: 'copy-table-h', label: r.copyTableWithHeaders, run: () => onCopyTable(true) },
        ]}
      >
        <Codicon name="export" size={14} />
        <span>{r.export}</span>
      </Dropdown>
      <div className="toolbar-spacer" />
      <label className="results-limit">
        <span>{r.limit}</span>
        <Select
          value={String(current)}
          onChange={(e) => setLimit(tab.id, e.target.value === 'all' ? 'all' : Number(e.target.value))}
          options={[
            ...limitOptions
              .sort((a, b) => a - b)
              .map((n) => ({ value: String(n), label: n.toLocaleString('es') })),
            { value: 'all', label: r.limitAll },
          ]}
        />
      </label>
    </div>
  );
}

function formatStat(n: number): string {
  const sep = separators({
    'format.locale': setting('format.locale'),
    'format.number.decimalSeparator': setting('format.number.decimalSeparator'),
    'format.number.thousandsSeparator': setting('format.number.thousandsSeparator'),
  } as Parameters<typeof separators>[0]);
  const text = Number.isInteger(n) ? String(n) : n.toFixed(2);
  const [int, frac] = text.split('.');
  const grouped = sep.thousands ? int!.replace(/\B(?=(\d{3})+(?!\d))/g, sep.thousands) : int!;
  return frac !== undefined ? `${grouped}${sep.decimal}${frac}` : grouped;
}

function ResultsFooter({
  tab,
  result,
  stats,
}: {
  tab: EditorTab;
  result: ResultSet;
  stats: SelectionStats | null;
}): React.JSX.Element {
  const r = es.results;
  return (
    <div className="results-footer" data-testid="results-footer">
      <span>
        {r.rows(result.rows.length)}
        {result.truncated && (
          <>
            {' ('}
            {r.truncated}
            {result.hasMore && (
              <>
                {' — '}
                {result.loadingMore ? (
                  r.loading
                ) : (
                  <>
                    <button
                      type="button"
                      className="link"
                      onClick={() => void loadMore(tab.id, result.id, false)}
                    >
                      {r.loadMore}
                    </button>
                    {' · '}
                    <button
                      type="button"
                      className="link"
                      onClick={() => void loadMore(tab.id, result.id, true)}
                    >
                      {r.loadAll}
                    </button>
                  </>
                )}
              </>
            )}
            {')'}
          </>
        )}
      </span>
      {result.done && <span>{es.units.ms(result.durationMs)}</span>}
      <span>{result.executedAt}</span>
      <span className="toolbar-spacer" />
      {stats && (
        <span data-testid="selection-stats">
          {r.summary(
            formatStat(stats.sum),
            formatStat(stats.avg),
            formatStat(stats.min),
            formatStat(stats.max),
          )}
        </span>
      )}
    </div>
  );
}

const MESSAGE_ICON: Record<MessageEntry['kind'], { icon: string; color: string }> = {
  info: { icon: 'info', color: 'var(--fg-muted)' },
  notice: { icon: 'comment', color: 'var(--link)' },
  warning: { icon: 'warning', color: 'var(--warning)' },
  error: { icon: 'error', color: 'var(--error)' },
};

function MessagesView({ tabId, messages }: { tabId: string; messages: MessageEntry[] }): React.JSX.Element {
  const endRef = useRef<HTMLDivElement>(null);
  // Llaves: en Chromium reciente `scrollIntoView` devuelve una promesa, y un efecto solo puede devolver su limpieza.
  useEffect(() => {
    void endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);
  return (
    <div className="panel-body messages" data-testid="messages" tabIndex={0}>
      {messages.map((m) => {
        const icon = MESSAGE_ICON[m.kind];
        return (
          <div key={m.id} className={['message', `is-${m.kind}`].join(' ')}>
            <span className="message-time">{m.time}</span>
            <Codicon name={icon.icon} color={icon.color} size={14} />
            <span className="message-text">{m.text}</span>
            {m.line !== undefined && (
              <button
                type="button"
                className="link"
                onClick={() => revealPosition(tabId, m.line!, m.column ?? 1)}
              >
                {es.results.goToLine(m.line)}
              </button>
            )}
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
