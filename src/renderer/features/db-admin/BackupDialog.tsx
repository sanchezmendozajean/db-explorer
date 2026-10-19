import { useEffect, useRef, useState } from 'react';
import type { ToolFamilyStatus } from '@shared/db-admin';
import { backupModeOf, majorVersion, suggestedBackupName, toolFamilyOf } from '@shared/db-admin';
import { Button } from '../../components/Button';
import { Checkbox, TextInput } from '../../components/Inputs';
import { Codicon } from '../../components/Codicon';
import { Modal } from '../../components/Modal';
import { dotStyle } from '../../components/env-dot';
import { connectionAddress } from '@shared/connection';
import { es } from '../../i18n/es';
import { connectionById, useConnectionsStore } from '../../stores/connections-store';
import { showToast } from '../../stores/toast-store';
import { refreshConnection } from './db-admin-actions';

const t = es.dbAdmin.backup;

type Phase = { name: 'form' } | { name: 'running' } | { name: 'error'; message: string };

/**
 * Respaldo o restauración de una base. PostgreSQL y MariaDB/MySQL usan las herramientas auxiliares
 * (archivo elegido en un diálogo de main); SQL Server lo hace el propio servidor y la ruta es del servidor.
 */
export function BackupDialog({
  connectionId,
  database,
  kind,
  onClose,
}: {
  connectionId: string;
  database: string;
  kind: 'backup' | 'restore';
  onClose: () => void;
}): React.JSX.Element | null {
  const conn = connectionById(connectionId);
  const status = useConnectionsStore((s) => s.status[connectionId]);
  const hasSavedPassword = useConnectionsStore((s) => s.savedPasswordIds.has(connectionId));
  const server = status?.state === 'connected' ? status.server : undefined;

  const engine = conn?.engine ?? 'postgres';
  const mode = backupModeOf(engine);
  const family = toolFamilyOf(engine, server?.product);
  const isBackup = kind === 'backup';

  const [path, setPath] = useState(
    mode === 'server' && isBackup ? suggestedBackupName(engine, database) : '',
  );
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  // Opciones de pg_restore (solo PostgreSQL): base destino y las dos opciones, activas de forma predeterminada.
  const [target, setTarget] = useState(database);
  const [noOwner, setNoOwner] = useState(true);
  const [noPrivileges, setNoPrivileges] = useState(true);
  // Opciones propias de MariaDB/MySQL.
  const [removeDefiner, setRemoveDefiner] = useState(true);
  const [routines, setRoutines] = useState(true);
  const [triggers, setTriggers] = useState(true);
  const [events, setEvents] = useState(true);
  const [structureOnly, setStructureOnly] = useState(false);
  const [phase, setPhase] = useState<Phase>({ name: 'form' });
  const [tool, setTool] = useState<ToolFamilyStatus | null>(null);
  const operationId = useRef(crypto.randomUUID());

  useEffect(() => {
    if (mode !== 'tools') return;
    let alive = true;
    void window.api.tools.status({}).then((r) => {
      if (alive && r.ok) setTool(r.data.find((s) => s.family === family) ?? null);
    });
    return () => {
      alive = false;
    };
  }, [mode, family]);

  if (!conn) return null;
  const running = phase.name === 'running';
  const needsPassword = mode === 'tools' && !hasSavedPassword;
  const production = conn.environment === 'prod';
  const pgRestore = !isBackup && engine === 'postgres';
  const myRestore = !isBackup && engine === 'mariadb';
  const myBackup = isBackup && engine === 'mariadb';
  const restoreTarget = pgRestore || myRestore ? target.trim() : database;

  const toolFile = tool?.files[isBackup ? 0 : 1];
  const olderTool =
    family === 'postgres' && toolFile?.version && server
      ? majorVersion(toolFile.version) < majorVersion(server.version)
      : false;

  const browse = async (): Promise<void> => {
    const r = await window.api.dbadmin.pickFile({
      mode: isBackup ? 'save' : 'open',
      engine,
      defaultName: suggestedBackupName(engine, database),
    });
    if (r.ok && r.data.path) {
      setPath(r.data.path);
      setPhase({ name: 'form' });
    }
  };

  const start = async (): Promise<void> => {
    if (!path.trim()) {
      setPhase({ name: 'error', message: t.pathRequired });
      return;
    }
    setPhase({ name: 'running' });
    const request = {
      connectionId,
      database: restoreTarget,
      path: path.trim(),
      operationId: operationId.current,
      family: family ?? undefined,
      password: password || undefined,
      options: pgRestore ? { noOwner, noPrivileges } : myRestore ? { removeDefiner } : undefined,
      dump: myBackup ? { routines, triggers, events, structureOnly } : undefined,
    };
    const r = isBackup ? await window.api.dbadmin.backup(request) : await window.api.dbadmin.restore(request);
    if (r.ok) {
      onClose();
      if (isBackup) {
        const data = r.data as { path: string; bytes?: number };
        showToast('success', t.done(database, data.path, data.bytes));
      } else {
        showToast('success', t.restored(restoreTarget));
        refreshConnection(connectionId);
      }
      return;
    }
    if (r.error.code === 'cancelled') {
      operationId.current = crypto.randomUUID();
      setPhase({ name: 'form' });
      showToast('info', t.cancelled);
      return;
    }
    operationId.current = crypto.randomUUID();
    setPhase({ name: 'error', message: r.error.message });
  };

  const canStart =
    !running && (isBackup || confirmed) && (mode === 'server' || path.trim() !== '') && restoreTarget !== '';

  const warning = !isBackup && (
    <p className="form-hint is-warning">
      {t.restoreWarning(restoreTarget || database)} {production && es.dbAdmin.drop.production}
    </p>
  );

  return (
    <Modal
      title={isBackup ? t.title(database) : t.restoreTitle}
      onClose={() => !running && onClose()}
      width={590}
      accentColor={!isBackup && production ? 'var(--error)' : undefined}
      footer={
        running ? (
          <>
            {mode === 'tools' && (
              <Button
                variant="secondary"
                onClick={() => void window.api.dbadmin.cancel({ operationId: operationId.current })}
              >
                {t.cancel}
              </Button>
            )}
          </>
        ) : (
          <>
            {!isBackup && (
              <Checkbox
                className="form-checkbox footer-left"
                label={t.restoreConfirm}
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
            )}
            <Button variant="secondary" onClick={onClose}>
              {es.dialogs.cancel}
            </Button>
            <Button
              variant={isBackup ? 'primary' : 'danger'}
              disabled={!canStart}
              onClick={() => void start()}
              data-testid="backup-start"
            >
              {isBackup ? t.start : t.startRestore}
            </Button>
          </>
        )
      }
    >
      {!isBackup && (
        <div className="form-field">
          <span className="form-label">{t.targetHost}</span>
          <div className="restore-host" data-testid="restore-host">
            <span className="env-dot" style={dotStyle(conn.color ?? `var(--env-${conn.environment})`)} />
            <strong>{conn.name}</strong>
            <span className="restore-host-address">{connectionAddress(conn)}</span>
          </div>
        </div>
      )}

      <label className="form-field">
        <span className="form-label">{mode === 'server' ? t.serverFile : t.file}</span>
        <div className="form-inline">
          <TextInput
            className="grow"
            value={path}
            readOnly={mode === 'tools'}
            disabled={running}
            placeholder={mode === 'server' ? suggestedBackupName(engine, database) : undefined}
            aria-label={mode === 'server' ? t.serverFile : t.file}
            data-testid="backup-path"
            data-autofocus
            onChange={(e) => {
              setPath(e.target.value);
              setPhase({ name: 'form' });
            }}
          />
          {mode === 'tools' && (
            <Button variant="secondary" disabled={running} onClick={() => void browse()}>
              {t.browse}
            </Button>
          )}
        </div>
      </label>
      {mode === 'server' && <p className="form-hint">{t.serverHint}</p>}
      {engine === 'sqlserver' && warning}

      {toolFile?.installed && (
        <p className="form-hint">{t.toolVersion(toolFile.name, toolFile.version ?? '')}</p>
      )}
      {olderTool && toolFile?.version && server && (
        <p className="form-hint is-warning">{t.toolOlder(toolFile.version, server.version)}</p>
      )}

      {myRestore && (
        <>
          <label className="form-field">
            <span className="form-label">{t.database.label}</span>
            <TextInput
              value={target}
              disabled={running}
              aria-label={t.database.label}
              data-testid="restore-dbname"
              invalid={restoreTarget === ''}
              onChange={(e) => setTarget(e.target.value)}
            />
            <span className="form-hint">{t.database.hint}</span>
          </label>
          {warning}
          <hr className="form-divider" />
          <div className="restore-option">
            <Checkbox
              className="form-checkbox"
              label={t.removeDefiner.label}
              checked={removeDefiner}
              disabled={running}
              data-testid="restore-remove-definer"
              onChange={(e) => setRemoveDefiner(e.target.checked)}
            />
            <span className="form-hint">{t.removeDefiner.hint}</span>
          </div>
        </>
      )}

      {myBackup && (
        <>
          {(
            [
              ['routines', routines, setRoutines],
              ['triggers', triggers, setTriggers],
              ['events', events, setEvents],
              ['structureOnly', structureOnly, setStructureOnly],
            ] as const
          ).map(([key, value, set]) => (
            <div className="restore-option" key={key}>
              <Checkbox
                className="form-checkbox"
                label={t.dump[key].label}
                checked={value}
                disabled={running}
                data-testid={`dump-${key}`}
                onChange={(e) => set(e.target.checked)}
              />
              <span className="form-hint">{t.dump[key].hint}</span>
            </div>
          ))}
        </>
      )}

      {pgRestore && (
        <>
          <label className="form-field">
            <span className="form-label">{t.dbname.label}</span>
            <TextInput
              value={target}
              disabled={running}
              aria-label={t.dbname.label}
              data-testid="restore-dbname"
              invalid={restoreTarget === ''}
              onChange={(e) => setTarget(e.target.value)}
            />
            <span className="form-hint">{t.dbname.hint}</span>
          </label>
          {warning}
          <hr className="form-divider" />
          <div className="restore-columns">
            <div className="restore-option">
              <Checkbox
                className="form-checkbox"
                label={t.noOwner.label}
                checked={noOwner}
                disabled={running}
                data-testid="restore-no-owner"
                onChange={(e) => setNoOwner(e.target.checked)}
              />
              <span className="form-hint">{t.noOwner.hint}</span>
            </div>
            <div className="restore-option">
              <Checkbox
                className="form-checkbox"
                label={t.noPrivileges.label}
                checked={noPrivileges}
                disabled={running}
                data-testid="restore-no-privileges"
                onChange={(e) => setNoPrivileges(e.target.checked)}
              />
              <span className="form-hint">{t.noPrivileges.hint}</span>
            </div>
          </div>
          {(!noOwner || !noPrivileges) && <p className="form-hint is-warning">{t.optionsHint}</p>}
        </>
      )}

      {needsPassword && (
        <label className="form-field">
          <span className="form-label">{t.password}</span>
          <TextInput
            type="password"
            value={password}
            disabled={running}
            autoComplete="off"
            aria-label={t.password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="form-hint">{t.passwordHint}</span>
        </label>
      )}

      {!isBackup && (
        <p className="form-hint">
          {
            t.restoreNotes[
              conn.engine === 'sqlserver' ? 'sqlserver' : conn.engine === 'postgres' ? 'postgres' : 'mariadb'
            ]
          }
        </p>
      )}

      {running && (
        <p className="backup-running" role="status" data-testid="backup-running">
          <Codicon name="loading" className="codicon-modifier-spin" />
          {isBackup ? t.running : t.runningRestore}
        </p>
      )}
      {phase.name === 'error' && (
        <pre className="backup-error" role="alert" data-testid="backup-error">
          {phase.message}
        </pre>
      )}
    </Modal>
  );
}
