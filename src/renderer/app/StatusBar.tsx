import { Codicon } from '../components/Codicon';
import { commands, useKeyStatus } from '../commands/service';
import { es } from '../i18n/es';
import { useConnectionsStore } from '../stores/connections-store';
import { useSettingsStore } from '../stores/settings-store';
import { useWorkbenchStore } from '../stores/workbench-store';
import { useCursorStore } from '../features/editor/editor-instance';
import { useSaveIndicator } from '../features/editor/save-indicator';
import { getDocument } from '../features/editor/documents';
import { useElapsed } from '../features/editor/EditorToolbar';
import { effectiveTarget } from '../features/editor/target-pickers';
import { EMPTY_TAB_RESULTS, useResultsStore } from '../features/results/results-store';

const ENGINE_LANGUAGE: Record<string, string> = {
  postgres: 'SQL (PostgreSQL)',
  mariadb: 'SQL (MariaDB)',
  sqlite: 'SQL (SQLite)',
  sqlserver: 'SQL (T-SQL)',
};

/** Status bar (specs/04 §11). En Producción se tiñe entera. */
export function StatusBar(): React.JSX.Element {
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === s.activeId));
  const keyMessage = useKeyStatus((s) => s.message);
  const connection = useConnectionsStore((s) => s.connections.find((c) => c.id === tab?.connectionId));
  const status = useConnectionsStore((s) => (tab?.connectionId ? s.status[tab.connectionId] : undefined));
  const cursor = useCursorStore();
  const autoSave = useSettingsStore((s) => s.settings['files.autoSave']);
  const tabSize = useSettingsStore((s) => s.settings.editor['tabSize']);
  const saving = useSaveIndicator((s) => s.active > 0);
  const running = useResultsStore((s) => (tab ? (s.byTab[tab.id] ?? EMPTY_TAB_RESULTS).running : null));
  const elapsed = useElapsed(running?.startedAt);
  const isProd = connection?.environment === 'prod';
  const isScript = tab?.kind === 'script';
  const doc = tab ? getDocument(tab.id) : undefined;
  const eol = doc ? (doc.model.getEOL() === '\r\n' ? 'CRLF' : 'LF') : 'CRLF';
  const { database, schema } = effectiveTarget(tab);

  return (
    <footer className={['statusbar', isProd ? 'is-prod' : ''].join(' ')} data-testid="statusbar">
      <div className="statusbar-left">
        {connection ? (
          <button
            type="button"
            className="statusbar-env"
            style={{ background: connection.color ?? `var(--env-${connection.environment})` }}
            title={es.statusBar.changeConnection}
            onClick={() => void commands.execute('db.changeConnection')}
          >
            <Codicon name="database" size={14} />
            <span>{connection.name}</span>
          </button>
        ) : (
          isScript && (
            <button
              type="button"
              className="statusbar-item"
              title={es.statusBar.changeConnection}
              onClick={() => void commands.execute('db.changeConnection')}
            >
              {es.statusBar.noConnection}
            </button>
          )
        )}
        {status?.state === 'connected' && <span className="statusbar-item">{status.server.product}</span>}
        {connection && database && (
          <button
            type="button"
            className="statusbar-item"
            title={es.statusBar.changeTarget}
            onClick={() => void commands.execute('db.changeSchema')}
          >
            {database}
            {schema ? ` · ${schema}` : ''}
          </button>
        )}
        {elapsed && (
          <span className="statusbar-item" data-testid="statusbar-running">
            <Codicon name="loading" spin size={14} />
            {es.statusBar.executing(elapsed.slice(0, 5))}
          </span>
        )}
        {keyMessage && <span className="statusbar-item">{keyMessage}</span>}
      </div>
      <div className="statusbar-right">
        {isScript && (
          <span className="statusbar-item" data-testid="cursor-position">
            {es.statusBar.position(cursor.line, cursor.column)}
            {cursor.selected > 0 ? ` (${es.statusBar.selected(cursor.selected)})` : ''}
          </span>
        )}
        <button
          type="button"
          className={['statusbar-item', autoSave ? '' : 'is-muted'].join(' ')}
          title={es.statusBar.toggleAutoSave}
          data-testid="autosave-toggle"
          onClick={() => void commands.execute('db.toggleAutoSave')}
        >
          <Codicon name={saving ? 'loading' : 'save'} spin={saving} size={14} />
          {autoSave ? es.statusBar.autoSave : es.statusBar.autoSaveOff}
        </button>
        {isScript && (
          <>
            <span className="statusbar-item">
              {es.statusBar.spaces(typeof tabSize === 'number' ? tabSize : 4)}
            </span>
            <span className="statusbar-item">UTF-8</span>
            <span className="statusbar-item">{eol}</span>
            <span className="statusbar-item">{connection ? ENGINE_LANGUAGE[connection.engine] : 'SQL'}</span>
            {connection && <span className="statusbar-item">{es.statusBar.autoCommit}</span>}
          </>
        )}
        <span className="statusbar-item" title={es.statusBar.notifications}>
          <Codicon name="bell" size={14} />
        </span>
      </div>
    </footer>
  );
}
