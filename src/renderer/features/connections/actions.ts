import type { ConnectionConfig } from '@shared/connection';
import { es } from '../../i18n/es';
import { connectionById, useConnectionsStore } from '../../stores/connections-store';
import { useOverlayStore } from '../../stores/overlay-store';
import { showToast } from '../../stores/toast-store';

const store = useConnectionsStore.getState;
const overlay = useOverlayStore.getState;
const c = es.connections;

/**
 * Conecta; si no hay contraseña guardada, abre el diálogo para pedirla.
 * Devuelve true si quedó conectada.
 */
export async function connect(id: string, password?: string): Promise<boolean> {
  const result = await store().connect(id, password);
  if (result.ok) return true;
  if (result.passwordRequired) {
    useConnectionsStore.setState({ expandOnConnect: id });
    overlay().openDialog({ id: 'password', connectionId: id });
    return false;
  }
  const name = connectionById(id)?.name ?? id;
  showToast('error', c.connectFailed(name, result.error.message));
  return false;
}

/**
 * Asegura que la conexión esté abierta antes de usarla (p. ej. al ejecutar):
 * conecta y, si hace falta, pide la contraseña y espera la respuesta.
 */
export async function ensureConnected(id: string): Promise<boolean> {
  if (store().status[id]?.state === 'connected') return true;
  const result = await store().connect(id);
  if (result.ok) return true;
  if (!result.passwordRequired) {
    showToast('error', c.connectFailed(connectionById(id)?.name ?? id, result.error.message));
    return false;
  }
  return new Promise((resolve) => {
    overlay().openDialog({ id: 'password', connectionId: id, onResult: resolve });
  });
}

export function disconnect(id: string): Promise<void> {
  return store().disconnect(id);
}

export function newConnection(folder?: string): void {
  overlay().openDialog({ id: 'connection', folder });
}

export function editConnection(id: string): void {
  overlay().openDialog({ id: 'connection', editId: id });
}

export async function duplicateConnection(id: string): Promise<void> {
  const original = connectionById(id);
  if (!original) return;
  const copy: ConnectionConfig = {
    ...original,
    id: crypto.randomUUID(),
    name: `${original.name}${c.copySuffix}`,
  };
  await store().save(copy, { copyPasswordFrom: original.id });
  // Se ubica justo después del original.
  const s = store();
  const order = s.connections.filter((x) => x.id !== copy.id);
  order.splice(order.findIndex((x) => x.id === id) + 1, 0, copy);
  await s.setLayout(
    s.folders,
    order.map(({ id: cid, folder }) => ({ id: cid, folder })),
  );
}

export function renameConnection(id: string): void {
  const conn = connectionById(id);
  if (!conn) return;
  overlay().openDialog({
    id: 'prompt',
    title: c.renameConnectionTitle,
    label: c.connectionName,
    initialValue: conn.name,
    confirmLabel: c.rename,
    validate: (v) => (v.trim() ? null : c.nameRequired),
    onSubmit: (name) => void store().save({ ...conn, name: name.trim() }),
  });
}

export function deleteConnection(id: string): void {
  const conn = connectionById(id);
  if (!conn) return;
  overlay().openDialog({
    id: 'confirm',
    title: c.deleteConnectionTitle,
    message: c.deleteConnection(conn.name),
    confirmLabel: c.delete,
    danger: true,
    onConfirm: () => void store().remove(id),
  });
}

function layoutWith(
  folders: string[],
  map: (conn: ConnectionConfig) => string | undefined = (conn) => conn.folder,
): Promise<void> {
  const s = store();
  return s.setLayout(
    folders,
    s.connections.map((conn) => ({ id: conn.id, folder: map(conn) })),
  );
}

export function moveToFolder(id: string, folder: string | undefined): Promise<void> {
  return layoutWith(store().folders, (conn) => (conn.id === id ? folder : conn.folder));
}

function folderNameValidator(current?: string) {
  return (value: string): string | null => {
    const name = value.trim();
    if (!name) return c.nameRequired;
    if (name !== current && store().folders.includes(name)) return c.folderExists;
    return null;
  };
}

/** Crea una carpeta; si se indica `thenMove`, mueve esa conexión dentro. */
export function newFolder(thenMove?: string): void {
  overlay().openDialog({
    id: 'prompt',
    title: c.newFolderTitle,
    label: c.folderName,
    initialValue: '',
    confirmLabel: c.create,
    validate: folderNameValidator(),
    onSubmit: (value) => {
      const name = value.trim();
      const folders = [...store().folders, name];
      void layoutWith(folders, (conn) => (conn.id === thenMove ? name : conn.folder));
    },
  });
}

export function renameFolder(folder: string): void {
  overlay().openDialog({
    id: 'prompt',
    title: c.renameFolderTitle,
    label: c.folderName,
    initialValue: folder,
    confirmLabel: c.rename,
    validate: folderNameValidator(folder),
    onSubmit: (value) => {
      const name = value.trim();
      const folders = store().folders.map((f) => (f === folder ? name : f));
      void layoutWith(folders, (conn) => (conn.folder === folder ? name : conn.folder));
    },
  });
}

export function deleteFolder(folder: string): void {
  overlay().openDialog({
    id: 'confirm',
    title: c.deleteFolderTitle,
    message: c.deleteFolder(folder),
    confirmLabel: c.delete,
    danger: true,
    onConfirm: () =>
      void layoutWith(
        store().folders.filter((f) => f !== folder),
        (conn) => (conn.folder === folder ? undefined : conn.folder),
      ),
  });
}

export function copyText(text: string): void {
  void window.api.app.clipboardWrite({ text }).then((r) => r.ok && showToast('info', es.toasts.copied));
}

export type DropTarget = { type: 'folder'; name: string } | { type: 'connection'; id: string };

/**
 * Soltar en el árbol: una conexión sobre una carpeta entra al final de esa
 * carpeta; sobre otra conexión se ubica antes de ella (y toma su carpeta).
 * Una carpeta sobre otra carpeta se ubica antes de ella.
 */
export function dropOnto(
  dragged: { type: 'folder'; name: string } | { type: 'connection'; id: string },
  target: DropTarget,
): Promise<void> {
  const s = store();
  if (dragged.type === 'folder') {
    if (target.type !== 'folder' || target.name === dragged.name) return Promise.resolve();
    const folders = s.folders.filter((f) => f !== dragged.name);
    folders.splice(folders.indexOf(target.name), 0, dragged.name);
    return layoutWith(folders);
  }
  const moving = s.connections.find((x) => x.id === dragged.id);
  if (!moving || (target.type === 'connection' && target.id === dragged.id)) return Promise.resolve();
  const rest = s.connections.filter((x) => x.id !== dragged.id);
  let index: number;
  let folder: string | undefined;
  if (target.type === 'folder') {
    folder = target.name;
    const last = rest.map((x) => x.folder).lastIndexOf(target.name);
    index = last >= 0 ? last + 1 : rest.length;
  } else {
    const t = rest.findIndex((x) => x.id === target.id);
    folder = rest[t]?.folder;
    index = t < 0 ? rest.length : t;
  }
  rest.splice(index, 0, { ...moving, folder });
  return s.setLayout(
    s.folders,
    rest.map((x) => ({ id: x.id, folder: x.folder })),
  );
}
