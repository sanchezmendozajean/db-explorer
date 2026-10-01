import { withDefaultExtension } from '@shared/workspace';
import { es } from '../../i18n/es';
import { commands } from '../../commands/service';
import { isInside, parentOf, pathKey, useFilesStore } from '../../stores/files-store';
import type { FileEditing } from '../../stores/files-store';
import { setting, useSettingsStore } from '../../stores/settings-store';
import { showToast } from '../../stores/toast-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { useConnectionsStore } from '../../stores/connections-store';
import { useOverlayStore } from '../../stores/overlay-store';
import { askChoice } from '../dialogs/ask';
import { fileName, getDocument } from '../editor/documents';
import { applyMoves, closeTrashed, openScript, setTabTarget, tabForPath } from '../editor/scripts';

/**
 * Operaciones de la vista Archivos (specs/07). Todas pasan por main, que las
 * restringe al espacio de trabajo; aquí se actualizan el árbol y las pestañas.
 */

const files = useFilesStore.getState;

function failed(message: string): void {
  showToast('error', es.files.operationFailed(message));
}

/** Nodo seleccionado en el árbol (o `null`). */
export function selectedPath(): string | null {
  return files().selected;
}

/** Carpeta destino para "Nuevo…" y "Pegar": la seleccionada, la del archivo seleccionado o la raíz. */
export function targetDir(path = selectedPath()): string {
  const root = files().root;
  if (!path) return root;
  const node = findNode(path);
  return node?.dir ? path : parentOf(path);
}

/** Nodo cargado del árbol para una ruta. */
export function findNode(path: string): { path: string; dir: boolean } | undefined {
  if (pathKey(path) === pathKey(files().root)) return { path, dir: true };
  const nodes = files().dirs[pathKey(parentOf(path))] ?? [];
  return nodes.find((n) => pathKey(n.path) === pathKey(path));
}

/** Empieza a crear un archivo o carpeta con un campo en línea en la carpeta destino. */
export async function startNew(type: 'file' | 'folder', dir = targetDir()): Promise<void> {
  if (pathKey(dir) !== pathKey(files().root)) await files().toggle(dir, true);
  files().setEditing({ kind: 'new', dir, type });
}

export function startRename(path = selectedPath()): void {
  if (!path || pathKey(path) === pathKey(files().root)) return;
  files().setEditing({ kind: 'rename', path });
}

/** Confirma la edición en línea (Enter o al perder el foco). */
export async function commitEditing(editing: FileEditing, rawName: string): Promise<void> {
  files().setEditing(null);
  const name = rawName.trim();
  if (!name) return;
  if (editing.kind === 'new') {
    const finalName = editing.type === 'file' ? withDefaultExtension(name) : name;
    const r = await window.api.fs.create({ dir: editing.dir, name: finalName, kind: editing.type });
    if (!r.ok) return failed(r.error.message);
    await files().refresh([r.data.path]);
    files().select(r.data.path);
    if (editing.type === 'file') await openScript(r.data.path);
    return;
  }
  if (name === fileName(editing.path)) return;
  const r = await window.api.fs.rename({ path: editing.path, name });
  if (!r.ok) return failed(r.error.message);
  applyMoves([{ from: editing.path, to: r.data.path }]);
  await files().refresh([editing.path, r.data.path]);
  files().select(r.data.path);
}

/** Envía a la Papelera con confirmación (specs/07: nunca borrado permanente). */
export async function trash(paths: readonly string[] = selected()): Promise<void> {
  if (paths.length === 0) return;
  const names = paths.map(fileName);
  const answer = await askChoice({
    title: es.files.deleteTitle,
    message: names.length === 1 ? es.files.deleteOne(names[0]!) : es.files.deleteMany(names.length),
    items: names.length > 1 ? names : undefined,
    buttons: [
      { value: 'trash', label: es.files.moveToTrash, variant: 'danger' },
      { value: 'cancel', label: es.dialogs.cancel },
    ],
  });
  if (answer !== 'trash') return;
  const r = await window.api.fs.trash({ paths: [...paths] });
  if (!r.ok) return failed(r.error.message);
  closeTrashed(paths);
  await files().refresh(paths);
  if (paths.some((p) => files().selected && isInside(p, files().selected!))) files().select(null);
}

function selected(): string[] {
  const path = selectedPath();
  return path && pathKey(path) !== pathKey(files().root) ? [path] : [];
}

export function copyToClipboard(cut: boolean, paths: readonly string[] = selected()): void {
  if (paths.length === 0) return;
  files().setClipboard({ paths: [...paths], cut });
}

/** Pega lo copiado (copia con " copia" si el nombre existe) o lo cortado (mueve). */
export async function paste(dir = targetDir()): Promise<void> {
  const clip = files().clipboard;
  if (!clip) return;
  if (clip.cut) {
    const ok = await move(clip.paths, dir, { confirm: false });
    if (ok) files().setClipboard(null);
    return;
  }
  const r = await window.api.fs.copy({ paths: clip.paths, targetDir: dir });
  if (!r.ok) return failed(r.error.message);
  await files().refresh(r.data.created);
  if (r.data.created[0]) files().select(r.data.created[0]);
}

export async function duplicate(path = selectedPath()): Promise<void> {
  if (!path || pathKey(path) === pathKey(files().root)) return;
  const r = await window.api.fs.copy({ paths: [path], targetDir: parentOf(path) });
  if (!r.ok) return failed(r.error.message);
  await files().refresh(r.data.created);
  if (r.data.created[0]) files().select(r.data.created[0]);
}

/** Mueve a una carpeta (arrastrar y soltar o pegar lo cortado). Devuelve true si se movió. */
export async function move(
  paths: readonly string[],
  dir: string,
  options: { confirm: boolean } = { confirm: true },
): Promise<boolean> {
  const sources = paths.filter((p) => pathKey(parentOf(p)) !== pathKey(dir));
  if (sources.length === 0) return false;
  if (options.confirm && setting('files.confirmDragAndDrop')) {
    const answer = await askChoice({
      title: es.files.moveTitle,
      message: es.files.moveConfirm(sources.map(fileName), fileName(dir)),
      buttons: [
        { value: 'move', label: es.files.move, variant: 'primary' },
        { value: 'always', label: es.files.moveDontAsk },
        { value: 'cancel', label: es.dialogs.cancel },
      ],
    });
    if (answer !== 'move' && answer !== 'always') return false;
    if (answer === 'always') await useSettingsStore.getState().update('files.confirmDragAndDrop', false);
  }
  const r = await window.api.fs.move({ paths: sources, targetDir: dir });
  if (!r.ok) {
    failed(r.error.message);
    return false;
  }
  applyMoves(r.data.moved);
  await files().refresh([...r.data.moved.map((m) => m.from), ...r.data.moved.map((m) => m.to)]);
  if (r.data.moved[0]) files().select(r.data.moved[0].to);
  return true;
}

/** Copia la ruta absoluta o relativa al espacio (Shift+Alt+C / Ctrl+K Ctrl+Shift+C). */
export async function copyPath(relative: boolean, path = selectedPath()): Promise<void> {
  if (!path) return;
  const root = useWorkspaceStore.getState().path;
  const text = relative && isInside(root, path) ? path.slice(root.length + 1) || '.' : path;
  await window.api.app.clipboardWrite({ text });
}

export async function reveal(path = selectedPath() ?? files().root): Promise<void> {
  const r = await window.api.fs.reveal({ path });
  if (!r.ok) failed(r.error.message);
}

export async function openExternal(path = selectedPath()): Promise<void> {
  if (!path) return;
  const r = await window.api.fs.openExternal({ path });
  if (!r.ok) failed(r.error.message);
}

/** "Ejecutar en…": elige la conexión, abre el archivo y lo ejecuta como script (specs/07). */
export function runIn(path = selectedPath()): void {
  if (!path) return;
  const items = useConnectionsStore.getState().connections.map((c) => ({
    id: c.id,
    label: c.name,
    icon: 'circle-filled',
    iconColor: c.color ?? `var(--env-${c.environment})`,
    detail: es.connections.engines[c.engine],
    run: () => void runWith(path, c.id),
  }));
  useOverlayStore.getState().openPick({ placeholder: es.files.runInPlaceholder, items });
}

async function runWith(path: string, connectionId: string): Promise<void> {
  await openScript(path);
  const tab = tabForPath(path);
  if (!tab) return;
  setTabTarget(tab.id, { connectionId });
  // Se espera a que el editor muestre el documento antes de ejecutar.
  for (let i = 0; i < 80 && !getDocument(tab.id); i++) await new Promise((r) => setTimeout(r, 25));
  await commands.execute('db.executeScript');
}
