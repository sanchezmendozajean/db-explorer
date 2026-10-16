import type * as MonacoApi from 'monaco-editor/editor/editor.api';
import { create } from 'zustand';
import { withoutKey } from '@shared/records';
import { es } from '../../i18n/es';
import { connectionById } from '../../stores/connections-store';
import type { EditorTab } from '../../stores/workbench-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import { ensureConnected } from '../connections/actions';
import { askChoice } from '../dialogs/ask';
import { languageFor } from '../editor/documents';
import { setModelOwner } from '../editor/model-owners';
import { loadMonaco, monacoIfLoaded } from '../editor/monaco/loader';
import { MARKER_OWNER } from '../execution/execute';
import { addMessage, forgetTab, useResultsStore } from '../results/results-store';
import { useUiStore } from '../../stores/ui-store';
import type { ObjectRefData } from './object-details';

/**
 * Pestaña de procedimiento o función (editar la definición y guardarla en la base con Ctrl+S).
 * El texto vive en un modelo de Monaco por pestaña, que sobrevive al cambio de pestañas; el
 * estado reactivo (cargando, guardando, error) va en el store.
 */

type TextModel = MonacoApi.editor.ITextModel;
type ViewState = MonacoApi.editor.ICodeEditorViewState;

export interface RoutineStatus {
  phase: 'loading' | 'ready' | 'error';
  saving: boolean;
}

interface Entry {
  model: TextModel;
  /** Texto de la base en la última carga o guardado: lo que no es "cambio sin guardar". */
  original: string;
  viewState: ViewState | null;
}

const entries = new Map<string, Entry>();
const loads = new Map<string, Promise<void>>();

export const useRoutineStore = create<{ byTab: Record<string, RoutineStatus> }>(() => ({ byTab: {} }));

const INITIAL: RoutineStatus = { phase: 'loading', saving: false };

export function routineStatus(tabId: string): RoutineStatus {
  return useRoutineStore.getState().byTab[tabId] ?? INITIAL;
}

function setStatus(tabId: string, changes: Partial<RoutineStatus>): void {
  useRoutineStore.setState((s) => ({
    byTab: { ...s.byTab, [tabId]: { ...routineStatus(tabId), ...changes } },
  }));
}

export function routineModel(tabId: string): TextModel | undefined {
  return entries.get(tabId)?.model;
}

export function rememberRoutineViewState(tabId: string, state: ViewState | null): void {
  const entry = entries.get(tabId);
  if (entry) entry.viewState = state;
}

export function routineViewState(tabId: string): ViewState | null {
  return entries.get(tabId)?.viewState ?? null;
}

export function routineTabId(connectionId: string, ref: ObjectRefData): string {
  return `routine:${JSON.stringify([connectionId, ref.database, ref.schema, ref.kind, ref.name])}`;
}

/** Abre (o enfoca) la pestaña de edición de una rutina y carga su definición. */
export function openRoutineTab(connectionId: string, ref: ObjectRefData): void {
  const conn = connectionById(connectionId);
  if (!conn) return;
  const wb = useWorkbenchStore.getState();
  const id = routineTabId(connectionId, ref);
  if (!wb.tabs.some((t) => t.id === id)) {
    const crumbs = [
      conn.name,
      ref.database,
      ...(conn.engine === 'postgres' || conn.engine === 'sqlserver' ? [ref.schema] : []),
      ref.name,
    ];
    wb.open({
      id,
      kind: 'routine',
      title: ref.name,
      tooltip: crumbs.join(' › '),
      connectionId,
      database: ref.database,
      schema: ref.schema,
      dirty: false,
      preview: false,
      object: ref,
    });
  }
  wb.activate(id);
  void loadRoutine(id);
}

function tabOf(tabId: string): EditorTab | undefined {
  return useWorkbenchStore.getState().tabs.find((t) => t.id === tabId);
}

function syncDirty(tabId: string): void {
  const entry = entries.get(tabId);
  if (!entry) return;
  const dirty = entry.model.getValue() !== entry.original;
  if (tabOf(tabId)?.dirty !== dirty) useWorkbenchStore.getState().update(tabId, { dirty });
}

/** Lee la definición de la base. Con `force` descarta lo editado y vuelve a leer. */
export function loadRoutine(tabId: string, options: { force?: boolean } = {}): Promise<void> {
  if (entries.has(tabId) && !options.force) return Promise.resolve();
  const running = loads.get(tabId);
  if (running) return running;
  const promise = doLoad(tabId).finally(() => loads.delete(tabId));
  loads.set(tabId, promise);
  return promise;
}

async function doLoad(tabId: string): Promise<void> {
  const tab = tabOf(tabId);
  const conn = connectionById(tab?.connectionId);
  if (!tab?.object || !conn) return;
  setStatus(tabId, { phase: entries.has(tabId) ? 'ready' : 'loading' });
  clearReport(tabId);
  try {
    if (!(await ensureConnected(conn.id))) throw new Error(es.routines.noDefinition);
    const r = await window.api.meta.ddl({ connectionId: conn.id, ...tab.object });
    if (!r.ok) throw new RoutineError(r.error.message);
    if (!r.data.ddl) throw new Error(es.routines.noDefinition);
    const monaco = await loadMonaco();
    if (!tabOf(tabId)) return; // se cerró mientras cargaba
    const text = r.data.ddl;
    const existing = entries.get(tabId);
    if (existing) {
      existing.original = text;
      existing.model.setValue(text);
    } else {
      entries.set(tabId, {
        model: monaco.editor.createModel(text, languageFor(conn.engine)),
        original: text,
        viewState: null,
      });
      entries.get(tabId)!.model.onDidChangeContent(() => syncDirty(tabId));
      setModelOwner(entries.get(tabId)!.model, tabId);
    }
    syncDirty(tabId);
    setStatus(tabId, { phase: 'ready' });
  } catch (err) {
    setStatus(tabId, { phase: entries.has(tabId) ? 'ready' : 'error' });
    report(tabId, 'error', err);
  }
}

/** Error del motor con su posición (1-based) dentro del texto enviado. */
class RoutineError extends Error {
  constructor(
    message: string,
    readonly position?: number,
  ) {
    super(message);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Quita los mensajes y las marcas del editor de un guardado anterior. */
function clearReport(tabId: string): void {
  const model = entries.get(tabId)?.model;
  const monaco = monacoIfLoaded();
  if (monaco && model) monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
  useResultsStore.setState((s) => {
    const tab = s.byTab[tabId];
    return tab ? { byTab: { ...s.byTab, [tabId]: { ...tab, messages: [] } } } : s;
  });
}

/**
 * Muestra el resultado en el panel inferior (pestaña Mensajes), como en los scripts: con "Ir a la
 * línea" y una marca en el editor cuando el motor informó la posición del error.
 */
function report(tabId: string, kind: 'info' | 'error', value: string | unknown): void {
  const text = typeof value === 'string' ? value : messageOf(value);
  let line: number | undefined;
  let column: number | undefined;
  const model = entries.get(tabId)?.model;
  const position = value instanceof RoutineError ? value.position : undefined;
  if (kind === 'error' && model && position !== undefined) {
    const at = model.getPositionAt(Math.max(0, position - 1));
    line = at.lineNumber;
    column = at.column;
    const monaco = monacoIfLoaded();
    if (monaco) {
      const word = model.getWordAtPosition(at);
      monaco.editor.setModelMarkers(model, MARKER_OWNER, [
        {
          severity: monaco.MarkerSeverity.Error,
          message: text,
          startLineNumber: line,
          startColumn: word ? word.startColumn : column,
          endLineNumber: line,
          endColumn: word ? word.endColumn : model.getLineMaxColumn(line),
        },
      ]);
    }
  }
  addMessage(tabId, { kind, text, line, column });
  useResultsStore.getState().setActiveView(tabId, 'messages');
  useUiStore.setState((s) => (s.panel.visible ? s : { panel: { ...s.panel, visible: true } }));
}

/** Pide confirmación y aplica el texto del editor en la base. Devuelve `true` si quedó guardado. */
export async function saveRoutine(tabId: string): Promise<boolean> {
  const tab = tabOf(tabId);
  const entry = entries.get(tabId);
  const conn = connectionById(tab?.connectionId);
  if (!tab?.object || !entry || !conn || routineStatus(tabId).saving) return false;
  if (conn.readOnly) {
    report(tabId, 'error', es.routines.readOnly);
    return false;
  }
  const how = es.routines.how[conn.engine as keyof typeof es.routines.how] ?? '';
  const production = conn.environment === 'prod';
  const answer = await askChoice({
    title: es.routines.saveTitle,
    message: `${es.routines.saveMessage(tab.object.name, how)}${production ? ` ${es.routines.production}` : ''}`,
    buttons: [
      { value: 'save', label: es.routines.apply, variant: production ? 'danger' : 'primary' },
      { value: 'cancel', label: es.dialogs.cancel },
    ],
  });
  if (answer !== 'save') return false;
  return applyRoutine(tabId);
}

/** Aplica el texto del editor sin preguntar (la confirmación ya se hizo). */
async function applyRoutine(tabId: string): Promise<boolean> {
  const tab = tabOf(tabId);
  const entry = entries.get(tabId);
  const conn = connectionById(tab?.connectionId);
  if (!tab?.object || !entry || !conn) return false;
  const text = entry.model.getValue();
  setStatus(tabId, { saving: true });
  clearReport(tabId);
  try {
    if (!(await ensureConnected(conn.id))) throw new Error(es.routines.noDefinition);
    const r = await window.api.meta.saveRoutine({ connectionId: conn.id, ...tab.object, definition: text });
    if (!r.ok) throw new RoutineError(r.error.message, r.error.position);
    entry.original = text;
    syncDirty(tabId);
    setStatus(tabId, { saving: false });
    report(tabId, 'info', es.routines.saved(tab.object.name));
    return true;
  } catch (err) {
    setStatus(tabId, { saving: false });
    report(tabId, 'error', err);
    return false;
  }
}

/** Libera el modelo y el estado de una pestaña de rutina que se cierra. */
export function disposeRoutineTab(tabId: string): void {
  entries.get(tabId)?.model.dispose();
  entries.delete(tabId);
  loads.delete(tabId);
  forgetTab(tabId);
  useRoutineStore.setState((s) => ({ byTab: withoutKey(s.byTab, tabId) }));
}

/**
 * Antes de cerrar pestañas: por cada rutina con cambios, "Guardar / No guardar / Cancelar".
 * Devuelve `false` si se canceló (o un guardado falló), y entonces no se cierra nada.
 */
export async function confirmRoutineChanges(ids: readonly string[]): Promise<boolean> {
  for (const id of ids) {
    const tab = tabOf(id);
    if (tab?.kind !== 'routine' || !tab.dirty) continue;
    useWorkbenchStore.getState().activate(id);
    const answer = await askChoice({
      title: es.routines.unsavedTitle,
      message: `${es.routines.unsavedMessage(tab.title)}${connectionById(tab.connectionId)?.environment === 'prod' ? ` ${es.routines.production}` : ''}`,
      buttons: [
        { value: 'save', label: es.routines.apply, variant: 'primary' },
        { value: 'discard', label: es.routines.dontSave },
        { value: 'cancel', label: es.dialogs.cancel },
      ],
    });
    if (answer === null || answer === 'cancel') return false;
    // Ya se confirmó: se aplica directo (sin repetir la pregunta de saveRoutine).
    if (answer === 'save' && !(await applyRoutine(id))) return false;
  }
  return true;
}
