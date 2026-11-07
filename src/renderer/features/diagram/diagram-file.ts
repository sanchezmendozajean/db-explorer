import {
  DIAGRAM_FILE_EXTENSION,
  isDiagramFileName,
  parseDiagramFile,
  serializeDiagramFile,
} from '@shared/diagram-file';
import { es } from '../../i18n/es';
import { connectionById, useConnectionsStore } from '../../stores/connections-store';
import { useFilesStore } from '../../stores/files-store';
import { showToast, useToastStore } from '../../stores/toast-store';
import { useUiStore } from '../../stores/ui-store';
import type { EditorTab } from '../../stores/workbench-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import { diagramFilePath, diagramState, patchDiagram, setDiagramFileListener } from './diagram-store';

/**
 * Archivos de diagrama (specs/13 §9): el diagrama se guarda en el espacio de trabajo como un JSON propio de
 * DB Explorer que se vuelve a dibujar sin consultar la base. Tras el primer guardado, los cambios
 * (cajas movidas, "Actualizar") se guardan solos.
 */

/** Espera tras el último cambio antes de escribir el archivo. */
const AUTOSAVE_DELAY_MS = 600;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;
const withoutExtension = (name: string): string =>
  name.replace(new RegExp(`\\.${DIAGRAM_FILE_EXTENSION}$`, 'i'), '');

function tabOf(tabId: string): EditorTab | undefined {
  return useWorkbenchStore.getState().tabs.find((t) => t.id === tabId);
}

/** Conexión de un archivo: por `id` y, si ya no está, por nombre y motor (p. ej. tras importar las conexiones). */
export function resolveConnection(origin: { id: string; name: string; engine: string }): string | undefined {
  const all = useConnectionsStore.getState().connections;
  return (
    all.find((c) => c.id === origin.id)?.id ??
    all.find((c) => c.name === origin.name && c.engine === origin.engine)?.id
  );
}

/**
 * Guarda el diagrama de la pestaña. La primera vez crea `Diagrama-<nombre>.dbxdiagram` en la raíz del
 * espacio de trabajo (sin sobrescribir otro); después reescribe ese mismo archivo.
 */
export async function saveDiagram(tabId: string, options: { silent?: boolean } = {}): Promise<boolean> {
  clearTimeout(timers.get(tabId));
  timers.delete(tabId);
  const tab = tabOf(tabId);
  const state = diagramState(tabId);
  if (!tab || state.load.status !== 'ready') return false;
  if (state.saving) {
    // Hay un guardado en curso: este cambio se guarda al terminar, no se pierde.
    scheduleDiagramSave(tabId);
    return false;
  }
  const conn = connectionById(tab.connectionId);
  const origin = conn ? { id: conn.id, name: conn.name, engine: conn.engine } : state.origin;
  if (!origin) return false;
  const content = serializeDiagramFile({
    connection: origin,
    database: tab.database ?? '',
    schema: tab.schema ?? '',
    diagram: state.load.diagram,
    positions: state.manual,
  });

  patchDiagram(tabId, { saving: true });
  try {
    if (tab.path) {
      const r = await window.api.fs.writeScript({ path: tab.path, content, bom: false, force: true });
      if (!r.ok) {
        showToast('error', es.diagram.saveFailed(r.error.message));
        return false;
      }
      if (!options.silent) showToast('success', es.diagram.saved(baseName(tab.path)));
      return true;
    }
    const r = await window.api.fs.saveExport({
      name: `Diagrama-${origin.name}`,
      extension: DIAGRAM_FILE_EXTENSION,
      content,
    });
    if (!r.ok) {
      showToast('error', es.diagram.saveFailed(r.error.message));
      return false;
    }
    const path = r.data.path;
    useWorkbenchStore.getState().update(tabId, {
      path,
      title: withoutExtension(baseName(path)),
      tooltip: path,
    });
    void useFilesStore.getState().refresh([path]);
    // Igual que un script nuevo, el archivo aparece en Archivos sin avisar; solo un guardado pedido muestra la notificación.
    if (options.silent) return true;
    useToastStore.getState().show({
      severity: 'success',
      message: es.diagram.saved(baseName(path)),
      actions: [
        {
          label: es.diagram.showInFiles,
          run: () => {
            useUiStore.getState().showView('files');
            void useFilesStore.getState().reveal(path);
          },
        },
      ],
    });
    return true;
  } finally {
    patchDiagram(tabId, { saving: false });
  }
}

/** Programa el guardado automático de un diagrama que ya tiene archivo. */
export function scheduleDiagramSave(tabId: string): void {
  // Un diagrama sin archivo lo crea de inmediato; los cambios siguientes se agrupan.
  if (!diagramFilePath(tabId)) {
    void saveDiagram(tabId, { silent: true });
    return;
  }
  clearTimeout(timers.get(tabId));
  timers.set(
    tabId,
    setTimeout(() => {
      timers.delete(tabId);
      void saveDiagram(tabId, { silent: true });
    }, AUTOSAVE_DELAY_MS),
  );
}

/** Guarda ya lo pendiente (al cerrar la pestaña, antes de olvidar su estado). */
export function flushDiagramSave(tabId: string): void {
  if (!timers.has(tabId) || !diagramFilePath(tabId)) return;
  void saveDiagram(tabId, { silent: true });
}

setDiagramFileListener(scheduleDiagramSave);

/** Archivos que se están abriendo: un doble clic pide dos veces el mismo archivo y avisaría dos veces de un error. */
const opening = new Set<string>();

/** Abre un archivo `.dbxdiagram`: valida su contenido antes de abrir la pestaña. */
export async function openDiagramFile(path: string, focus?: string): Promise<void> {
  if (opening.has(path)) return;
  opening.add(path);
  try {
    await openDiagramFileNow(path, focus);
  } finally {
    opening.delete(path);
  }
}

async function openDiagramFileNow(path: string, focus: string | undefined): Promise<void> {
  const id = `diagram:file:${path}`;
  const wb = useWorkbenchStore.getState();
  // También puede estar abierto desde el árbol (un diagrama recién guardado conserva su pestaña).
  const open = wb.tabs.find(
    (t) => t.kind === 'diagram' && (t.id === id || t.path?.toLowerCase() === path.toLowerCase()),
  );
  if (open) {
    wb.update(open.id, { diagramFocus: focus });
    wb.activate(open.id);
    return;
  }
  const r = await window.api.fs.readScript({ path });
  if (!r.ok) {
    showToast('error', es.files.openFailed(baseName(path), r.error.message));
    return;
  }
  const parsed = parseDiagramFile(r.data.content);
  if (!parsed.ok) {
    showToast('error', es.diagram.openInvalid(baseName(path), parsed.reason));
    return;
  }
  const { file } = parsed;
  const connectionId = resolveConnection(file.connection);
  wb.open({
    id,
    kind: 'diagram',
    title: withoutExtension(baseName(path)),
    tooltip: path,
    path,
    connectionId,
    database: file.database,
    schema: file.schema,
    dirty: false,
    preview: false,
    diagramFocus: focus,
  });
}

/** Máximo de archivos de diagrama que se revisan al buscar el de un esquema. */
const MAX_FILES_SCANNED = 50;

/**
 * Ruta del archivo de diagrama del espacio de trabajo que corresponde a ese esquema de esa conexión
 * (por `id` de conexión o, si cambió, por nombre y motor), si existe.
 */
export async function findDiagramFile(
  connectionId: string,
  scope: { database: string; schema: string },
): Promise<string | undefined> {
  const conn = connectionById(connectionId);
  const listed = await window.api.workspace.listFiles({});
  if (!listed.ok) return undefined;
  const candidates: string[] = [];
  const walk = (nodes: { name: string; path: string; dir: boolean; children?: unknown }[]): void => {
    for (const n of nodes) {
      if (n.dir) walk((n.children as typeof nodes | undefined) ?? []);
      else if (isDiagramFileName(n.name)) candidates.push(n.path);
    }
  };
  walk(listed.data);
  for (const path of candidates.sort().slice(0, MAX_FILES_SCANNED)) {
    const r = await window.api.fs.readScript({ path });
    if (!r.ok) continue;
    const parsed = parseDiagramFile(r.data.content);
    if (!parsed.ok) continue;
    const { file } = parsed;
    const sameConnection =
      file.connection.id === connectionId ||
      (!!conn && file.connection.name === conn.name && file.connection.engine === conn.engine);
    if (sameConnection && file.database === scope.database && file.schema === scope.schema) return path;
  }
  return undefined;
}
