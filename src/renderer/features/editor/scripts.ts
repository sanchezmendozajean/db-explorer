import type { ScriptTabState, WorkspaceState } from '@shared/workspace';
import { isTextFile } from '@shared/workspace';
import { es } from '../../i18n/es';
import { currentContext } from '../../commands/service';
import { connectionById, useConnectionsStore } from '../../stores/connections-store';
import type { TreeTarget } from '../../stores/connections-store';
import { setting } from '../../stores/settings-store';
import { showToast } from '../../stores/toast-store';
import { useOverlayStore } from '../../stores/overlay-store';
import { activeTab, useWorkbenchStore } from '../../stores/workbench-store';
import type { EditorTab } from '../../stores/workbench-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { isInside, pathKey, useFilesStore } from '../../stores/files-store';
import { askChoice } from '../dialogs/ask';
import { forgetTab, tabResults } from '../results/results-store';
import {
  allDocuments,
  disposeDocument,
  fileName,
  getDocument,
  isDirty,
  languageForFile,
  pendingSaves,
  saveAll,
  saveDocument,
  saveDocumentAs,
  setDocumentPath,
  setPendingViewState,
  viewStateOf,
} from './documents';
import { activeEditor } from './editor-instance';
import { monacoIfLoaded } from './monaco/loader';

const wb = useWorkbenchStore.getState;

/** Id estable de la pestaña de un archivo (Windows no distingue mayúsculas en rutas). */
export function scriptTabId(path: string): string {
  return `script:${path.toLowerCase()}`;
}

/** ¿La pestaña es de un script SQL? (los demás archivos de texto se editan sin conexión ni ejecución). */
export function isSqlPath(path: string | undefined): boolean {
  return !!path && /\.sql$/i.test(path);
}

/** Título de la pestaña: los scripts sin `.sql`; los demás archivos con su extensión. */
function tabTitle(path: string): string {
  return fileName(path).replace(/\.sql$/i, '');
}

/** Pestaña abierta de un archivo (por ruta: el id no cambia si el archivo se renombra). */
export function tabForPath(path: string): EditorTab | undefined {
  const key = pathKey(path);
  return wb().tabs.find((t) => t.path && pathKey(t.path) === key);
}

export function scriptTab(path: string, target: Partial<TreeTarget> = {}): EditorTab {
  return {
    id: scriptTabId(path),
    kind: 'script',
    title: tabTitle(path),
    tooltip: path,
    path,
    connectionId: target.connectionId,
    database: target.database,
    schema: target.schema,
    dirty: false,
    preview: false,
  };
}

/**
 * Conexión para un script nuevo (specs/11 §1): la seleccionada en el árbol
 * si el foco está ahí; si no, la de la pestaña activa; si no, la del árbol.
 */
function defaultTarget(): Partial<TreeTarget> {
  const tree = useConnectionsStore.getState().treeSelection;
  if (tree && currentContext().has('treeFocus')) return tree;
  const tab = activeTab();
  if (tab?.connectionId)
    return { connectionId: tab.connectionId, database: tab.database, schema: tab.schema };
  return tree ?? {};
}

/** Crea `Script-N.sql` en el espacio de trabajo y lo abre (Ctrl+N). */
export async function newScript(
  target: Partial<TreeTarget> = defaultTarget(),
  content?: string,
): Promise<void> {
  const r = await window.api.workspace.newScript({});
  if (!r.ok) {
    showToast('error', es.scripts.createFailed(r.error.message));
    return;
  }
  // El contenido inicial (p. ej. SELECT de una tabla) se escribe antes de abrir la pestaña.
  if (content) await window.api.fs.writeScript({ path: r.data.path, content, bom: false });
  const tab = scriptTab(r.data.path, target);
  wb().open(tab);
  void useFilesStore.getState().refresh([r.data.path]);
  focusEditorWhenReady(tab.id);
}

/**
 * Abre un archivo (specs/07): los de texto en el editor, con la conexión que
 * se usó la última vez con ese script; los demás con la aplicación del
 * sistema. Con `preview` (clic simple en el árbol) la pestaña es provisional
 * y la reemplaza la siguiente vista previa; editar o doble clic la fija.
 */
export async function openScript(
  path: string,
  options: { preview?: boolean; focus?: boolean } = {},
): Promise<void> {
  if (!isTextFile(fileName(path))) {
    const r = await window.api.fs.openExternal({ path });
    if (!r.ok) showToast('error', es.files.openFailed(fileName(path), r.error.message));
    return;
  }
  const focus = options.focus ?? true;
  const existing = tabForPath(path);
  if (existing) {
    wb().activate(existing.id);
    if (!options.preview && existing.preview) wb().pin(existing.id);
    if (focus) focusEditorWhenReady(existing.id);
    return;
  }
  // La vista previa anterior se cierra (guardando si hiciera falta) antes de abrir la nueva.
  const previous = wb().tabs.find((t) => t.preview);
  if (options.preview && previous) await closeTabs([previous.id]);
  const tab = { ...scriptTab(path, connectionFor(path)), preview: !!options.preview };
  wb().open(tab);
  if (focus) focusEditorWhenReady(tab.id);
}

/** Conexión asociada a un archivo (la última usada con él), sin distinguir mayúsculas en la ruta. */
function connectionFor(path: string): Partial<TreeTarget> {
  if (!isSqlPath(path)) return {};
  const key = pathKey(path);
  const entry = Object.entries(fileConnections).find(([file]) => pathKey(file) === key);
  return entry ? entry[1] : {};
}

/**
 * Un archivo o carpeta se renombró o movió: las pestañas de los archivos
 * afectados conservan su id (sesión, resultados, cambios sin guardar) y
 * cambian de ruta y título.
 */
export function applyMoves(moves: readonly { from: string; to: string }[]): void {
  for (const { from, to } of moves) {
    for (const tab of wb().tabs) {
      if (!tab.path || !isInside(from, tab.path)) continue;
      const path = to + tab.path.slice(from.length);
      wb().update(tab.id, { path, title: tabTitle(path), tooltip: path });
      setDocumentPath(tab.id, path);
    }
    fileConnections = Object.fromEntries(
      Object.entries(fileConnections).map(([file, target]) => [
        isInside(from, file) ? to + file.slice(from.length) : file,
        target,
      ]),
    );
  }
  scheduleWorkspaceSave();
}

/** "Guardar como…": la pestaña pasa al archivo nuevo (con su lenguaje si cambió la extensión). */
export async function saveActiveAs(): Promise<void> {
  const tab = activeTab();
  if (!tab?.path) return;
  const path = await saveDocumentAs(tab.id);
  if (!path) return;
  wb().update(tab.id, { path, title: tabTitle(path), tooltip: path, preview: false });
  const doc = getDocument(tab.id);
  const monaco = monacoIfLoaded();
  if (doc && monaco) {
    monaco.editor.setModelLanguage(
      doc.model,
      languageForFile(path, connectionById(tab.connectionId)?.engine),
    );
  }
  void useFilesStore.getState().refresh([path]);
  scheduleWorkspaceSave();
}

/** Archivo › Abrir archivo… (Ctrl+O): también de fuera del espacio de trabajo (specs/11 §2). */
export async function openFileWithDialog(): Promise<void> {
  const r = await window.api.fs.openFileDialog({ title: es.files.openFileTitle });
  if (r.ok && r.data.path) await openScript(r.data.path);
}

/** Cambia el fin de línea del archivo activo (clic en la status bar, specs/07). */
export function changeEol(): void {
  const tab = activeTab();
  const doc = tab ? getDocument(tab.id) : undefined;
  const monaco = monacoIfLoaded();
  if (!doc || !monaco) return;
  const current = doc.model.getEOL() === '\r\n' ? 'crlf' : 'lf';
  useOverlayStore.getState().openPick({
    placeholder: es.files.eolPlaceholder,
    items: [
      {
        id: 'lf',
        label: es.files.eolLf,
        current: current === 'lf',
        run: () => doc.model.setEOL(monaco.editor.EndOfLineSequence.LF),
      },
      {
        id: 'crlf',
        label: es.files.eolCrlf,
        current: current === 'crlf',
        run: () => doc.model.setEOL(monaco.editor.EndOfLineSequence.CRLF),
      },
    ],
  });
}

/** Archivos enviados a la papelera: se cierran sus pestañas sin guardar (ya no existen). */
export function closeTrashed(paths: readonly string[]): void {
  const ids = wb()
    .tabs.filter((t) => t.path && paths.some((p) => isInside(p, t.path!)))
    .map((t) => t.id);
  for (const id of ids) {
    void window.api.query.closeSession({ sessionId: id });
    forgetTab(id);
    disposeDocument(id);
  }
  wb().remove(ids, { remember: false });
}

/**
 * Enfoca el editor cuando ya muestra el documento de la pestaña (se carga de
 * forma asíncrona). Si mientras tanto el usuario movió el foco (p. ej. abrió
 * la paleta), no se lo quita.
 */
function focusEditorWhenReady(
  tabId: string,
  attempts = 40,
  origin: Element | null = document.activeElement,
): void {
  const active = document.activeElement;
  const moved = active !== origin && active !== document.body && !active?.closest('.editor-group');
  if (moved) return;
  const editor = activeEditor();
  const doc = getDocument(tabId);
  if (editor && doc && editor.getModel() === doc.model) editor.focus();
  else if (attempts > 0) setTimeout(() => focusEditorWhenReady(tabId, attempts - 1, origin), 25);
}

/** Cambia la conexión/base/esquema de una pestaña (la sesión se reabre en la siguiente ejecución). */
export function setTabTarget(tabId: string, target: Partial<TreeTarget>): void {
  const tab = wb().tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const connectionChanged = target.connectionId !== undefined && target.connectionId !== tab.connectionId;
  wb().update(tabId, {
    connectionId: target.connectionId ?? tab.connectionId,
    database: connectionChanged ? target.database : (target.database ?? tab.database),
    schema: connectionChanged ? target.schema : target.schema === undefined ? tab.schema : target.schema,
  });
  const doc = getDocument(tabId);
  const monaco = monacoIfLoaded();
  if (doc && monaco && connectionChanged) {
    monaco.editor.setModelLanguage(
      doc.model,
      languageForFile(doc.path, connectionById(target.connectionId)?.engine),
    );
  }
}

// ——— Restaurar y guardar el estado del espacio de trabajo (specs/11 §3) ———

/**
 * Carga las pestañas guardadas de un espacio de trabajo (specs/11 §3) y avisa
 * de los archivos que ya no existen. Reemplaza las pestañas actuales.
 */
export function loadWorkspaceTabs(state: WorkspaceState | null, missing: readonly string[]): void {
  fileConnections = { ...(state?.fileConnections ?? {}) };
  const tabs = (state?.tabs ?? []).map((t) => {
    const tab = scriptTab(t.file, { connectionId: t.connectionId, database: t.database, schema: t.schema });
    setPendingViewState(tab.id, t.viewState);
    return tab;
  });
  wb().restore(tabs, state ? (tabs[state.activeTab]?.id ?? null) : null);
  if (missing.length > 0) {
    showToast('warning', es.scripts.missingFiles(missing.length), [
      {
        label: es.scripts.details,
        run: () =>
          void askChoice({
            title: es.scripts.missingTitle,
            message: es.scripts.missingMessage,
            items: [...missing],
            buttons: [{ value: 'ok', label: es.dialogs.ok, variant: 'primary' }],
          }),
      },
    ]);
  }
}

/**
 * Cierra todas las pestañas sin preguntar (al cambiar de espacio, después de
 * guardar): cancela ejecuciones, cierra sesiones y libera los documentos.
 */
export function discardAllTabs(): void {
  for (const tab of wb().tabs) {
    const running = tabResults(tab.id).running;
    if (running) void window.api.query.cancel({ queryId: running.queryId });
    void window.api.query.closeSession({ sessionId: tab.id });
    forgetTab(tab.id);
    disposeDocument(tab.id);
  }
  wb().restore([], null);
}

/** Conexión asociada a cada archivo, también de los que ya no están abiertos (specs/11 §3). */
let fileConnections: NonNullable<WorkspaceState['fileConnections']> = {};

export function buildWorkspaceState(): WorkspaceState {
  const { tabs, activeId } = wb();
  const scripts = tabs.filter((t) => t.kind === 'script' && t.path);
  for (const t of scripts) {
    if (t.connectionId && isSqlPath(t.path)) {
      fileConnections[t.path!] = { connectionId: t.connectionId, database: t.database, schema: t.schema };
    }
  }
  return {
    path: useWorkspaceStore.getState().path,
    tabs: scripts.map((t): ScriptTabState => ({
      type: 'script',
      file: t.path!,
      connectionId: t.connectionId,
      database: t.database,
      schema: t.schema,
      viewState: viewStateOf(t.id),
    })),
    activeTab: scripts.findIndex((t) => t.id === activeId),
    fileConnections,
  };
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;

export function saveWorkspaceStateNow(): Promise<unknown> {
  clearTimeout(persistTimer);
  persistTimer = undefined;
  return window.api.workspace.saveState(buildWorkspaceState());
}

/** Programa el guardado del estado con 1 s de retraso (specs/11 §3). */
export function scheduleWorkspaceSave(): void {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => void saveWorkspaceStateNow(), 1000);
}

export function startWorkspacePersistence(): () => void {
  return useWorkbenchStore.subscribe((s, prev) => {
    if (s.tabs !== prev.tabs || s.activeId !== prev.activeId) scheduleWorkspaceSave();
  });
}

// ——— Cerrar pestañas y la aplicación ———

/**
 * Cierra pestañas guardando antes (specs/11 §4): con guardado automático se
 * guardan sin preguntar; sin él, "Guardar / No guardar / Cancelar" por
 * archivo. Los scripts vacíos se eliminan de disco. Devuelve false si se canceló.
 */
export async function closeTabs(ids: readonly string[]): Promise<boolean> {
  const tabs = wb().tabs.filter((t) => ids.includes(t.id));
  const closable: string[] = [];
  const autoSave = setting('files.autoSave');
  for (const tab of tabs) {
    const doc = getDocument(tab.id);
    if (doc && isDirty(doc)) {
      if (autoSave) {
        if (!(await saveDocument(tab.id))) continue;
      } else {
        const answer = await askChoice({
          title: es.scripts.saveChangesTitle,
          message: es.scripts.saveChanges(fileName(doc.path)),
          buttons: [
            { value: 'save', label: es.scripts.save, variant: 'primary' },
            { value: 'discard', label: es.scripts.dontSave },
            { value: 'cancel', label: es.dialogs.cancel },
          ],
        });
        if (answer === null || answer === 'cancel') return false;
        if (answer === 'save' && !(await saveDocument(tab.id))) continue;
      }
    }
    closable.push(tab.id);
  }

  const deleted: string[] = [];
  for (const id of closable) {
    const tab = tabs.find((t) => t.id === id)!;
    if (tabResults(id).running) void window.api.query.cancel({ queryId: tabResults(id).running!.queryId });
    void window.api.query.closeSession({ sessionId: id });
    forgetTab(id);
    const doc = getDocument(id);
    const empty = doc ? doc.model.getValue().trim() === '' : true;
    if (tab.path && empty && setting('scripts.deleteEmptyOnClose')) {
      // main solo borra si el archivo en disco también está vacío.
      const r = await window.api.fs.deleteEmptyScript({ path: tab.path });
      if (r.ok && r.data.deleted) deleted.push(id);
    }
    disposeDocument(id);
  }
  wb().remove(closable);
  if (deleted.length > 0) wb().forgetClosed(deleted);
  return closable.length === ids.length;
}

export function closeActiveTab(): Promise<boolean> {
  const id = wb().activeId;
  return id ? closeTabs([id]) : Promise.resolve(true);
}

/** Tiempo máximo esperando guardados al cerrar la app (specs/11 §4). */
const CLOSE_SAVE_TIMEOUT_MS = 5000;

/** La ventana se va a cerrar: guarda, escribe el estado del espacio y confirma a main. */
export async function handleBeforeClose(): Promise<void> {
  if (setting('files.autoSave')) {
    const saved = await Promise.race([
      saveAll()
        .then(() => pendingSaves())
        .then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), CLOSE_SAVE_TIMEOUT_MS)),
    ]);
    if (!saved) {
      const answer = await askChoice({
        title: es.scripts.closeAppTitle,
        message: es.scripts.savesPending,
        buttons: [
          { value: 'close', label: es.scripts.closeAnyway, variant: 'danger' },
          { value: 'cancel', label: es.dialogs.cancel },
        ],
      });
      if (answer !== 'close') return;
    }
  } else {
    const dirty = allDocuments().filter((d) => isDirty(d));
    if (dirty.length > 0) {
      const answer = await askChoice({
        title: es.scripts.closeAppTitle,
        message: es.scripts.closeAppMessage(dirty.length),
        items: dirty.map((d) => fileName(d.path)),
        buttons: [
          { value: 'save', label: es.scripts.saveAll, variant: 'primary' },
          { value: 'discard', label: es.scripts.dontSave },
          { value: 'cancel', label: es.dialogs.cancel },
        ],
      });
      if (answer === null || answer === 'cancel') return;
      if (answer === 'save' && !(await saveAll())) return;
    }
  }
  // El viewState de la pestaña activa se toma del editor en este momento.
  const editor = activeEditor();
  const current = wb().activeId ? getDocument(wb().activeId!) : undefined;
  if (editor && current && editor.getModel() === current.model) current.viewState = editor.saveViewState();
  await saveWorkspaceStateNow();
  await window.api.app.closeReady({ phase: 'ready' });
}
