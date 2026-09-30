import { Codicon } from '../components/Codicon';
import { useKeyStatus } from '../commands/service';
import { es } from '../i18n/es';
import { SAMPLE_SCRIPTS, sampleConnection } from '../sample/sample-data';
import { useWorkbenchStore } from '../stores/workbench-store';
import { notAvailable } from './app-commands';

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
  const connection = sampleConnection(tab?.connectionId);
  const script = tab?.kind === 'script' ? SAMPLE_SCRIPTS[tab.title] : undefined;
  const isProd = connection?.environment === 'prod';

  return (
    <footer className={['statusbar', isProd ? 'is-prod' : ''].join(' ')} data-testid="statusbar">
      <div className="statusbar-left">
        {connection ? (
          <button
            type="button"
            className="statusbar-env"
            style={{ background: `var(--env-${connection.environment})` }}
            title={es.statusBar.changeConnection}
            onClick={() => notAvailable(es.statusBar.changeConnection)}
          >
            <Codicon name="database" size={14} />
            <span>{connection.name}</span>
          </button>
        ) : (
          tab && <span className="statusbar-item">{es.statusBar.noConnection}</span>
        )}
        {connection && <span className="statusbar-item">{connection.serverVersion}</span>}
        {connection?.database && (
          <span className="statusbar-item">
            {connection.database}
            {connection.schema ? ` · ${connection.schema}` : ''}
          </span>
        )}
        {keyMessage && <span className="statusbar-item">{keyMessage}</span>}
      </div>
      <div className="statusbar-right">
        {script && (
          <span className="statusbar-item">{es.statusBar.position(script.cursor[0], script.cursor[1])}</span>
        )}
        <span className="statusbar-item">
          <Codicon name="save" size={14} />
          {es.statusBar.autoSave}
        </span>
        {tab && (
          <>
            <span className="statusbar-item">{es.statusBar.spaces(4)}</span>
            <span className="statusbar-item">UTF-8</span>
            <span className="statusbar-item">CRLF</span>
            {connection && <span className="statusbar-item">{ENGINE_LANGUAGE[connection.engine]}</span>}
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
