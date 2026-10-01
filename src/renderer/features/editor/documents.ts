import type * as MonacoApi from 'monaco-editor/editor/editor.api';
import type { Engine } from '@shared/connection';
import { es } from '../../i18n/es';
import { connectionById } from '../../stores/connections-store';
import { setting } from '../../stores/settings-store';
import { isToastVisible, showToast } from '../../stores/toast-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import type { EditorTab } from '../../stores/workbench-store';
import { loadMonaco } from './monaco/loader';
import { useSaveIndicator } from './save-indicator';

type TextModel = MonacoApi.editor.ITextModel;
export type ViewState = MonacoApi.editor.ICodeEditorViewState;

/**
 * Documento de un script abierto (specs/11): un `ITextModel` de Monaco por
 * pestaña, su estado en disco y el guardado automático.
 */
export interface ScriptDocument {
  tabId: string;
  path: string;
  model: TextModel;
  bom: boolean;
  /** `mtime` de la última lectura o escritura (para detectar cambios externos). */
  mtimeMs: number;
  /** `alternativeVersionId` del modelo en el último guardado. */
  savedVersion: number;
  viewState: ViewState | null;
  saving: Promise<boolean> | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** El archivo cambió en disco: no se guarda solo hasta que el usuario decida. */
  conflict: boolean;
  /** Aviso de conflicto visible (para no duplicarlo). */
  conflictToast?: number;
}

const documents = new Map<string, ScriptDocument>();
const loading = new Map<string, Promise<ScriptDocument | null>>();
/** viewState restaurado del espacio de trabajo, pendiente hasta que se abra el documento. */
const pendingViewStates = new Map<string, ViewState>();
const listeners = new Set<(doc: ScriptDocument) => void>();

export function languageFor(engine: Engine | undefined): string {
  if (engine === 'postgres') return 'pgsql';
  if (engine === 'mariadb') return 'mysql';
  return 'sql';
}

/** Lenguaje de Monaco de un archivo: SQL según el motor; los demás por extensión (specs/07). */
export function languageForFile(path: string, engine: Engine | undefined): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'sql':
      return languageFor(engine);
    case 'json':
      // Sin el servicio de JSON (pesado) se resalta con la gramática de JavaScript.
      return 'javascript';
    case 'md':
      return 'markdown';
    case 'xml':
      return 'xml';
    case 'yml':
    case 'yaml':
      return 'yaml';
    default:
      return 'plaintext';
  }
}

export function getDocument(tabId: string): ScriptDocument | undefined {
  return documents.get(tabId);
}

export function allDocuments(): ScriptDocument[] {
  return [...documents.values()];
}

export function isDirty(doc: ScriptDocument): boolean {
  return doc.model.getAlternativeVersionId() !== doc.savedVersion;
}

export function setPendingViewState(tabId: string, viewState: unknown): void {
  if (viewState && typeof viewState === 'object') pendingViewStates.set(tabId, viewState as ViewState);
}

/** viewState actual (del documento abierto o el restaurado), para guardar el estado del espacio. */
export function viewStateOf(tabId: string): ViewState | undefined {
  return documents.get(tabId)?.viewState ?? pendingViewStates.get(tabId);
}

/** Aviso a otros módulos (p. ej. limpiar marcas de ejecución al editar). */
export function onDocumentChange(listener: (doc: ScriptDocument) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Abre el documento de una pestaña de script: lee el archivo y crea el
 * modelo. Devuelve `null` si el archivo no se pudo leer.
 */
export function ensureDocument(tab: EditorTab): Promise<ScriptDocument | null> {
  const existing = documents.get(tab.id);
  if (existing) return Promise.resolve(existing);
  const pending = loading.get(tab.id);
  if (pending) return pending;
  if (!tab.path) return Promise.resolve(null);
  const path = tab.path;
  const promise = (async (): Promise<ScriptDocument | null> => {
    const [monaco, file] = await Promise.all([loadMonaco(), window.api.fs.readScript({ path })]);
    if (!file.ok) {
      showToast('error', es.scripts.readFailed(tab.title, file.error.message));
      return null;
    }
    // La pestaña pudo cerrarse mientras se leía.
    if (!useWorkbenchStore.getState().tabs.some((t) => t.id === tab.id)) return null;
    const uri = monaco.Uri.file(path);
    const language = languageForFile(path, connectionById(tab.connectionId)?.engine);
    const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(file.data.content, language, uri);
    // Los archivos nuevos (sin saltos de línea) usan CRLF, el estándar de Windows (D12).
    if (!file.data.content.includes('\n')) model.setEOL(monaco.editor.EndOfLineSequence.CRLF);
    const doc: ScriptDocument = {
      tabId: tab.id,
      path,
      model,
      bom: file.data.bom,
      mtimeMs: file.data.mtimeMs,
      savedVersion: model.getAlternativeVersionId(),
      viewState: pendingViewStates.get(tab.id) ?? null,
      saving: null,
      timer: undefined,
      conflict: false,
    };
    pendingViewStates.delete(tab.id);
    model.onDidChangeContent(() => onContentChange(doc));
    documents.set(tab.id, doc);
    return doc;
  })().finally(() => loading.delete(tab.id));
  loading.set(tab.id, promise);
  return promise;
}

function onContentChange(doc: ScriptDocument): void {
  const dirty = isDirty(doc);
  const tab = useWorkbenchStore.getState().tabs.find((t) => t.id === doc.tabId);
  if (tab && tab.dirty !== dirty) useWorkbenchStore.getState().update(doc.tabId, { dirty });
  // Editar una pestaña de vista previa la fija (como en VS Code).
  if (tab?.preview && dirty) useWorkbenchStore.getState().pin(doc.tabId);
  for (const l of listeners) l(doc);
  clearTimeout(doc.timer);
  doc.timer = undefined;
  if (dirty && setting('files.autoSave')) {
    doc.timer = setTimeout(
      () => void saveDocument(doc.tabId, { auto: true }),
      setting('files.autoSaveDelay'),
    );
  }
}

function markSaved(doc: ScriptDocument, version: number): void {
  doc.savedVersion = version;
  const dirty = isDirty(doc);
  useWorkbenchStore.getState().update(doc.tabId, { dirty });
}

/**
 * Guarda el documento en disco (escritura atómica en main). Si el archivo
 * cambió por fuera, no lo pisa: muestra un aviso con Sobrescribir / Recargar.
 * Devuelve true si quedó guardado.
 */
export async function saveDocument(
  tabId: string,
  options: { force?: boolean; auto?: boolean } = {},
): Promise<boolean> {
  const doc = documents.get(tabId);
  if (!doc) return true;
  clearTimeout(doc.timer);
  doc.timer = undefined;
  if (doc.saving) await doc.saving;
  if (!isDirty(doc) && !options.force) return true;
  if (doc.conflict && !options.force) {
    // El guardado automático espera la decisión; un guardado explícito vuelve a mostrar el aviso.
    if (!options.auto) showConflict(doc);
    return false;
  }

  const version = doc.model.getAlternativeVersionId();
  const content = doc.model.getValue();
  const done = useSaveIndicator.getState().start();
  const run = (async (): Promise<boolean> => {
    const r = await window.api.fs.writeScript({
      path: doc.path,
      content,
      bom: doc.bom,
      expectedMtimeMs: doc.mtimeMs,
      force: options.force,
    });
    if (r.ok) {
      doc.mtimeMs = r.data.mtimeMs;
      doc.conflict = false;
      markSaved(doc, version);
      return true;
    }
    const name = fileName(doc.path);
    if (r.error.code === 'conflict') {
      doc.conflict = true;
      showConflict(doc);
    } else {
      // El ● se mantiene y se reintenta en el siguiente disparador (specs/11 §4).
      showToast('error', es.scripts.saveFailed(name, r.error.message));
    }
    return false;
  })();
  doc.saving = run;
  try {
    return await run;
  } finally {
    doc.saving = null;
    done();
  }
}

/** Aviso de cambio externo con Sobrescribir / Recargar; no se oculta solo porque pide una decisión. */
function showConflict(doc: ScriptDocument): void {
  if (isToastVisible(doc.conflictToast)) return;
  const tabId = doc.tabId;
  doc.conflictToast = showToast(
    'warning',
    es.scripts.changedOnDisk(fileName(doc.path)),
    [
      { label: es.scripts.overwrite, run: () => void saveDocument(tabId, { force: true }) },
      { label: es.scripts.reload, run: () => void reloadDocument(tabId) },
    ],
    { sticky: true },
  );
}

/** Descarta los cambios del editor y vuelve a leer el archivo de disco. */
export async function reloadDocument(tabId: string): Promise<void> {
  const doc = documents.get(tabId);
  if (!doc) return;
  const r = await window.api.fs.readScript({ path: doc.path });
  if (!r.ok) {
    showToast('error', es.scripts.readFailed(fileName(doc.path), r.error.message));
    return;
  }
  doc.model.setValue(r.data.content);
  doc.mtimeMs = r.data.mtimeMs;
  doc.bom = r.data.bom;
  doc.conflict = false;
  markSaved(doc, doc.model.getAlternativeVersionId());
}

/** Guarda todos los documentos con cambios (al ejecutar, cerrar pestañas o la app). */
export async function saveAll(): Promise<boolean> {
  const results = await Promise.all(
    allDocuments()
      .filter((d) => isDirty(d))
      .map((d) => saveDocument(d.tabId)),
  );
  return results.every(Boolean);
}

/** Espera los guardados en curso. */
export async function pendingSaves(): Promise<void> {
  await Promise.all(allDocuments().map((d) => d.saving));
}

/**
 * "Guardar como…" (Ctrl+Shift+S): diálogo nativo (empieza en la carpeta del
 * archivo) y escritura. El documento pasa a ser el archivo nuevo; el original
 * queda como estaba en disco. Devuelve la ruta nueva o `null` si se canceló.
 */
export async function saveDocumentAs(tabId: string): Promise<string | null> {
  const doc = documents.get(tabId);
  if (!doc) return null;
  const version = doc.model.getAlternativeVersionId();
  const r = await window.api.fs.saveAs({
    defaultPath: doc.path,
    content: doc.model.getValue(),
    bom: doc.bom,
  });
  if (!r.ok) {
    showToast('error', es.scripts.saveFailed(fileName(doc.path), r.error.message));
    return null;
  }
  if (!r.data.path) return null;
  doc.path = r.data.path;
  doc.mtimeMs = r.data.mtimeMs;
  doc.conflict = false;
  markSaved(doc, version);
  return r.data.path;
}

/** El archivo de la pestaña se renombró o movió (o se guardó con otro nombre). */
export function setDocumentPath(tabId: string, path: string): void {
  const doc = documents.get(tabId);
  if (doc) doc.path = path;
}

/**
 * Archivos que cambiaron en disco (watcher). Si un documento abierto no tiene
 * cambios sin guardar, se recarga conservando el deshacer; si los tiene, se
 * marca el conflicto y el guardado automático espera la decisión del usuario.
 */
export async function handleExternalChanges(paths: readonly string[]): Promise<void> {
  const keys = new Set(paths.map((p) => p.toLowerCase()));
  for (const doc of documents.values()) {
    if (!keys.has(doc.path.toLowerCase()) || doc.saving) continue;
    const r = await window.api.fs.readScript({ path: doc.path });
    // Borrado o inaccesible: se deja como está (guardar lo vuelve a crear).
    if (!r.ok || Math.abs(r.data.mtimeMs - doc.mtimeMs) <= 1) continue;
    if (doc.saving || isDirty(doc)) {
      // Hay cambios sin guardar: se avisa ya (el guardado automático espera la decisión).
      doc.conflict = true;
      showConflict(doc);
      continue;
    }
    if (r.data.content !== doc.model.getValue()) {
      doc.model.pushEditOperations(
        [],
        [{ range: doc.model.getFullModelRange(), text: r.data.content }],
        () => null,
      );
    }
    doc.mtimeMs = r.data.mtimeMs;
    doc.bom = r.data.bom;
    doc.conflict = false;
    markSaved(doc, doc.model.getAlternativeVersionId());
  }
}

export function disposeDocument(tabId: string): void {
  const doc = documents.get(tabId);
  pendingViewStates.delete(tabId);
  if (!doc) return;
  clearTimeout(doc.timer);
  documents.delete(tabId);
  doc.model.dispose();
}

/** El guardado automático cambió: reprograma o cancela los temporizadores. */
export function autoSaveChanged(enabled: boolean): void {
  for (const doc of documents.values()) {
    clearTimeout(doc.timer);
    doc.timer = undefined;
    if (enabled && isDirty(doc)) {
      doc.timer = setTimeout(
        () => void saveDocument(doc.tabId, { auto: true }),
        setting('files.autoSaveDelay'),
      );
    }
  }
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
