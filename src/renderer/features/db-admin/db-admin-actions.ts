import { backupModeOf, toolFamilyOf } from '@shared/db-admin';
import { es } from '../../i18n/es';
import { connectionById, useConnectionsStore } from '../../stores/connections-store';
import { useOverlayStore } from '../../stores/overlay-store';
import { showToast } from '../../stores/toast-store';
import { invalidateDetails } from '../objects/object-details';

const store = useConnectionsStore.getState;
const overlay = useOverlayStore.getState;
const t = es.dbAdmin;

/** Vuelve a leer las bases de la conexión (y la estructura cacheada de sus objetos). */
export function refreshConnection(connectionId: string): void {
  invalidateDetails(connectionId);
  if (store().status[connectionId]?.state === 'connected') {
    void store().loadChildren(connectionId, { kind: 'connection' }, true);
  }
}

/** Rechaza (con aviso) las operaciones que modifican el servidor en una conexión de solo lectura. */
function writable(connectionId: string): boolean {
  if (connectionById(connectionId)?.readOnly) {
    showToast('warning', t.readOnly);
    return false;
  }
  return true;
}

function fail(action: keyof typeof t.actions, message: string): void {
  showToast('error', t.failed(t.actions[action], message));
}

export function createDatabase(connectionId: string): void {
  if (!writable(connectionId)) return;
  overlay().openDialog({
    id: 'prompt',
    title: t.create.title,
    label: t.create.label,
    initialValue: '',
    confirmLabel: t.create.confirm,
    validate: (v) => (v.trim() ? null : es.connections.nameRequired),
    onSubmit: (value) => {
      const name = value.trim();
      void window.api.dbadmin.create({ connectionId, name }).then((r) => {
        if (!r.ok) return fail('create', r.error.message);
        showToast('success', t.create.done(name));
        refreshConnection(connectionId);
      });
    },
  });
}

export function renameDatabase(connectionId: string, database: string): void {
  const conn = connectionById(connectionId);
  if (!conn || !writable(connectionId)) return;
  overlay().openDialog({
    id: 'prompt',
    title: t.rename.title(database),
    label: t.rename.label,
    message:
      t.rename.notes[conn.engine === 'postgres' || conn.engine === 'sqlserver' ? conn.engine : 'mariadb'],
    initialValue: database,
    confirmLabel: t.rename.confirm,
    validate: (v) => (!v.trim() ? es.connections.nameRequired : v.trim() === database ? t.rename.same : null),
    onSubmit: (value) => {
      const newName = value.trim();
      void window.api.dbadmin.rename({ connectionId, database, newName }).then((r) => {
        if (!r.ok) return fail('rename', r.error.message);
        showToast('success', t.rename.done(database, newName));
        refreshConnection(connectionId);
      });
    },
  });
}

/** Eliminar pide escribir el nombre de la base: la acción no se puede deshacer. */
export function dropDatabase(connectionId: string, database: string): void {
  const conn = connectionById(connectionId);
  if (!conn || !writable(connectionId)) return;
  const closes = conn.engine === 'postgres' || conn.engine === 'sqlserver';
  overlay().openDialog({
    id: 'prompt',
    title: t.drop.title,
    label: t.drop.label(database),
    message: [t.drop.message(database, closes), conn.environment === 'prod' ? t.drop.production : '']
      .filter(Boolean)
      .join(' '),
    initialValue: '',
    confirmLabel: t.drop.confirm,
    danger: true,
    validate: (v) => (v.trim() === database ? null : t.drop.mismatch),
    onSubmit: () => {
      void window.api.dbadmin.drop({ connectionId, database }).then((r) => {
        if (!r.ok) return fail('drop', r.error.message);
        showToast('success', t.drop.done(database));
        refreshConnection(connectionId);
      });
    },
  });
}

/**
 * Respaldar o restaurar. Con PostgreSQL y MariaDB/MySQL, si faltan las herramientas auxiliares se
 * abre primero el diálogo que las pide; SQL Server va directo (lo hace el servidor).
 */
export function backupOrRestore(connectionId: string, database: string, kind: 'backup' | 'restore'): void {
  const conn = connectionById(connectionId);
  if (!conn) return;
  if (kind === 'restore' && !writable(connectionId)) return;
  const open = (): void => overlay().openDialog({ id: 'backup', connectionId, database, kind });
  if (backupModeOf(conn.engine) !== 'tools') {
    open();
    return;
  }
  const st = store().status[connectionId];
  const family = toolFamilyOf(conn.engine, st?.state === 'connected' ? st.server.product : undefined);
  if (!family) return;
  void window.api.tools.status({}).then((r) => {
    const current = r.ok ? r.data.find((s) => s.family === family) : undefined;
    if (current?.files.every((f) => f.installed)) {
      open();
      return;
    }
    overlay().openDialog({ id: 'tools', family, onDone: (ready) => ready && open() });
  });
}
