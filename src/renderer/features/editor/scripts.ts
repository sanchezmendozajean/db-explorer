import type { ScriptTabState, WorkspaceState } from '@shared/workspace';
import { es } from '../../i18n/es';
import { currentContext } from '../../commands/service';
import { connectionById, useConnectionsStore } from '../../stores/connections-store';
import type { TreeTarget } from '../../stores/connections-store';
import { setting } from '../../stores/settings-store';
import { showToast } from '../../stores/toast-store';
import { activeTab, useWorkbenchStore } from '../../stores/workbench-store';
import type { EditorTab } from '../../stores/workbench-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { refreshFiles } from '../../stores/files-store';
import { askChoice } from '../dialogs/ask';
import { forgetTab, tabResults } from '../results/results-store';
import {
  allDocuments,
  disposeDocument,
  fileName,
  getDocument,
  isDirty,
  languageFor,
  pendingSaves,
  saveAll,
  saveDocument,
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

export function scriptTab(path: string, target: Partial<TreeTarget> = {}): EditorTab {
  const name = fileName(path);
  return {
    id: scriptTabId(path),
    kind: 'script',
    title: name.replace(/\.sql$/i, ''),
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
  refreshFiles();
  focusEditorWhenReady(tab.id);
}

/** Abre un archivo del espacio en una pestaña (o la enfoca), con su conexión asociada. */
export function openScript(path: string): void {
  const id = scriptTabId(path);
  if (wb().tabs.some((t) => t.id === id)) {
    wb().activate(id);
    focusEditorWhenReady(id);
    return;
  }
  wb().open(scriptTab(path, fileConnections[path] ?? {}));
  focusEditorWhenReady(id);
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
    monaco.editor.setModelLanguage(doc.model, languageFor(connectionById(target.connectionId)?.engine));
  }
}

// ——— Restaurar y guardar el estado del espacio de trabajo (specs/11 §3) ———

export async function restoreWorkspace(): Promise<void> {
  const r = await window.api.workspace.open({});
  if (!r.ok) {
    showToast('error', es.scripts.workspaceFailed(r.error.message));
    return;
  }
  const { path, name, state, missing } = r.data;
  useWorkspaceStore.getState().set(path, name);
  document.title = es.app.windowTitle(name);
  refreshFiles();
  if (state) {
    fileConnections = { ...(state.fileConnections ?? {}) };
    const tabs = state.tabs.map((t) => {
      const tab = scriptTab(t.file, { connectionId: t.connectionId, database: t.database, schema: t.schema });
      setPendingViewState(tab.id, t.viewState);
      return tab;
    });
    wb().restore(tabs, tabs[state.activeTab]?.id ?? null);
  }
  if (missing.length > 0) {
    showToast('warning', es.scripts.missingFiles(missing.length), [
      {
        label: es.scripts.details,
        run: () =>
          void askChoice({
            title: es.scripts.missingTitle,
            message: es.scripts.missingMessage,
            items: missing,
            buttons: [{ value: 'ok', label: es.dialogs.ok, variant: 'primary' }],
          }),
      },
    ]);
  }
}

/** Conexión asociada a cada archivo, también de los que ya no están abiertos (specs/11 §3). */
let fileConnections: NonNullable<WorkspaceState['fileConnections']> = {};

export function buildWorkspaceState(): WorkspaceState {
  const { tabs, activeId } = wb();
  const scripts = tabs.filter((t) => t.kind === 'script' && t.path);
  for (const t of scripts) {
    if (t.connectionId) {
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
  if (deleted.length > 0) {
    wb().forgetClosed(deleted);
    refreshFiles();
  }
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
