import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HistoryEntry } from '@shared/history';
import { Codicon } from '../../components/Codicon';
import { IconButton } from '../../components/Button';
import { Dropdown } from '../../components/Dropdown';
import { Select, TextInput } from '../../components/Inputs';
import { showContextMenu } from '../../components/ContextMenuHost';
import type { MenuEntry } from '../../components/menu-types';
import { SEPARATOR } from '../../components/menu-types';
import { VirtualTree } from '../../components/VirtualTree';
import type { TreeRow } from '../../components/VirtualTree';
import { es } from '../../i18n/es';
import { useConnectionsStore } from '../../stores/connections-store';
import { useSettingsStore } from '../../stores/settings-store';
import { showToast } from '../../stores/toast-store';
import { askChoice } from '../dialogs/ask';
import { insertIntoActiveEditor } from '../editor/editor-instance';
import { newScript } from '../editor/scripts';
import { SideBarHeader, Highlight } from '../side-bar/SideBarHeader';

type Row = TreeRow & { entry: HistoryEntry };

/** Fecha corta para la lista: hora si es de hoy; si no, día y hora. */
function when(at: number): string {
  const date = new Date(at);
  const today = new Date();
  const time = date.toLocaleTimeString('es', { hour12: false });
  if (date.toDateString() === today.toDateString()) return time;
  return `${date.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: '2-digit' })} ${time}`;
}

function firstLine(sql: string): string {
  const line = sql.trim().split(/\r?\n/, 1)[0] ?? '';
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

/** Abre la consulta en un script nuevo con su conexión (doble clic). */
function openInNewScript(entry: HistoryEntry): void {
  const exists = useConnectionsStore.getState().connections.some((c) => c.id === entry.connectionId);
  void newScript(exists ? { connectionId: entry.connectionId, database: entry.database } : {}, entry.sql);
}

/** Inserta la consulta en el script activo, en el cursor (Enter). */
function insert(entry: HistoryEntry): void {
  if (!insertIntoActiveEditor(entry.sql)) showToast('info', es.history.noActiveScript);
}

/**
 * Historial de consultas (specs/06 §Mensajes e historial): filtro por texto y
 * por conexión; doble clic abre en un script nuevo, Enter inserta en el actual.
 */
export function HistoryView(): React.JSX.Element {
  const h = es.history;
  const connections = useConnectionsStore((s) => s.connections);
  const enabled = useSettingsStore((s) => s.settings['history.enabled']);
  const updateSetting = useSettingsStore((s) => s.update);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [text, setText] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  /** Cambia para volver a leer la lista (al terminar una ejecución, Actualizar, borrar). */
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    void window.api.query
      .historyList({ text: text || undefined, connectionId: connectionId || undefined })
      .then((r) => {
        if (alive && r.ok) setEntries(r.data);
      });
    return () => {
      alive = false;
    };
  }, [text, connectionId, version]);

  // Al terminar cada ejecución aparecen sus sentencias.
  useEffect(
    () =>
      window.api.on('query:event', (event) => {
        if (event.type === 'execution-done') load();
      }),
    [load],
  );

  const rows = useMemo<Row[]>(
    () =>
      entries.map((entry) => ({ id: String(entry.id), depth: 0, expandable: false, expanded: false, entry })),
    [entries],
  );

  const remove = async (entry: HistoryEntry): Promise<void> => {
    await window.api.query.historyDelete({ id: entry.id });
    load();
  };

  const clearAll = async (): Promise<void> => {
    const answer = await askChoice({
      title: h.clearTitle,
      message: h.clearMessage,
      buttons: [
        { value: 'clear', label: h.clear, variant: 'danger' },
        { value: 'cancel', label: es.dialogs.cancel },
      ],
    });
    if (answer !== 'clear') return;
    await window.api.query.historyClear({});
    load();
  };

  const menu = (entry: HistoryEntry): MenuEntry[] => [
    { type: 'item', id: 'open', label: h.openInNewScript, run: () => openInNewScript(entry) },
    { type: 'item', id: 'insert', label: h.insert, keybinding: 'Enter', run: () => insert(entry) },
    {
      type: 'item',
      id: 'copy',
      label: h.copySql,
      run: () => void window.api.app.clipboardWrite({ text: entry.sql }),
    },
    SEPARATOR,
    { type: 'item', id: 'delete', label: h.delete, run: () => void remove(entry) },
  ];

  return (
    <div className="sidebar-view" data-view="history">
      <SideBarHeader
        title={es.sideBar.historyTitle}
        actions={
          <>
            <IconButton icon="refresh" label={es.sideBar.refresh} onClick={() => load()} />
            <Dropdown
              className="icon-btn"
              chevron={false}
              title={es.sideBar.more}
              entries={[
                {
                  type: 'item',
                  id: 'enabled',
                  label: h.enabled,
                  checked: enabled,
                  run: () => void updateSetting('history.enabled', !enabled),
                },
                { type: 'item', id: 'clear', label: h.clearAll, run: () => void clearAll() },
              ]}
            >
              <Codicon name="ellipsis" />
            </Dropdown>
          </>
        }
      />
      <div className="history-filters">
        <TextInput
          icon="filter"
          placeholder={h.filterPlaceholder}
          aria-label={h.filterPlaceholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setText('')}
        />
        <Select
          value={connectionId}
          aria-label={h.connection}
          onChange={(e) => setConnectionId(e.target.value)}
          options={[
            { value: '', label: h.allConnections },
            ...connections.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
      </div>
      {!enabled && <p className="history-note">{h.disabled}</p>}
      {rows.length === 0 ? (
        <div className="empty-state">
          <Codicon name="history" size={48} color="var(--fg-muted)" />
          <p>{text || connectionId ? es.sideBar.noMatches : es.sideBar.historyEmpty}</p>
        </div>
      ) : (
        <VirtualTree<Row>
          rows={rows}
          rowHeight={40}
          basePadding={4}
          ariaLabel={es.sideBar.historyTitle}
          focusContext="historyFocus"
          selectedId={selected}
          onSelect={setSelected}
          onToggle={() => undefined}
          onOpen={(row) => openInNewScript(row.entry)}
          onRowKeyDown={(e, row) => {
            if (e.key === 'Enter') {
              insert(row.entry);
              return true;
            }
            if (e.key === 'Delete') {
              void remove(row.entry);
              return true;
            }
            return false;
          }}
          onContextMenu={(row, e) => showContextMenu(e, menu(row.entry))}
          dragText={(row) => row.entry.sql}
          renderRow={(row) => {
            const e = row.entry;
            return (
              <div className="history-row" title={e.error ? `${e.sql}\n\n${e.error}` : e.sql}>
                <div className="history-sql">
                  <Codicon
                    name={e.ok ? 'pass' : 'error'}
                    color={e.ok ? 'var(--success)' : 'var(--error)'}
                    size={14}
                  />
                  <span className="history-text">
                    <Highlight text={firstLine(e.sql)} query={text} />
                  </span>
                </div>
                <div className="history-meta">
                  {[
                    when(e.at),
                    e.connectionName,
                    es.units.ms(e.durationMs),
                    e.rows !== undefined ? h.rows(e.rows) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
