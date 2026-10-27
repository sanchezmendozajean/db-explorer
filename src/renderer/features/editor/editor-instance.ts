import { create } from 'zustand';
import type * as MonacoApi from 'monaco-editor/editor/editor.api';
import type { KeyChord } from '../../commands/keybindings';
import {
  commands,
  keybindings,
  registerContextProvider,
  useKeybindingsVersion,
} from '../../commands/service';
import { evaluateWhen } from '../../commands/keybindings';
import type { EditorGroupIndex } from '../../stores/workbench-store';
import { groupOf, useWorkbenchStore } from '../../stores/workbench-store';
import type { Monaco } from './monaco/loader';

export type CodeEditor = MonacoApi.editor.IStandaloneCodeEditor;

/** Un editor Monaco por grupo (cambiar de pestaña = `setModel`). */
const editors = new Map<EditorGroupIndex, CodeEditor>();

/** Editor del grupo enfocado (nulo si ese grupo muestra una pestaña sin editor de texto). */
export function activeEditor(): CodeEditor | null {
  const { tabs, activeId } = useWorkbenchStore.getState();
  return editors.get(groupOf(tabs.find((t) => t.id === activeId))) ?? null;
}

/** Editor que muestra el modelo dado, en cualquiera de los grupos. */
export function editorShowing(model: unknown): CodeEditor | null {
  for (const editor of editors.values()) if (editor.getModel() === model) return editor;
  return null;
}

/** Inserta texto en el cursor del editor activo (p. ej. desde el historial). Devuelve false si no hay editor. */
export function insertIntoActiveEditor(text: string): boolean {
  const editor = activeEditor();
  const selection = editor?.getSelection();
  if (!editor || !selection || !editor.getModel()) return false;
  editor.executeEdits('db-explorer', [{ range: selection, text, forceMoveMarkers: true }]);
  editor.pushUndoStop();
  editor.focus();
  return true;
}

interface CursorState {
  line: number;
  column: number;
  /** Caracteres seleccionados (0 sin selección). */
  selected: number;
  set: (line: number, column: number, selected: number) => void;
}

/** Posición del cursor para la status bar. */
export const useCursorStore = create<CursorState>((set) => ({
  line: 1,
  column: 1,
  selected: 0,
  set: (line, column, selected) => set({ line, column, selected }),
}));

/** Traducción de teclas de la app a códigos de Monaco (para registrar acordes en el editor). */
function monacoKey(monaco: Monaco, key: string): number | undefined {
  const K = monaco.KeyCode;
  if (/^[a-z]$/.test(key)) return K[`Key${key.toUpperCase()}` as keyof typeof K] as number;
  if (/^\d$/.test(key)) return K[`Digit${key}` as keyof typeof K] as number;
  if (/^f\d{1,2}$/.test(key)) return K[key.toUpperCase() as keyof typeof K] as number;
  const map: Record<string, number> = {
    enter: K.Enter,
    escape: K.Escape,
    ' ': K.Space,
    tab: K.Tab,
    ',': K.Comma,
    '.': K.Period,
    '/': K.Slash,
    '-': K.Minus,
    '=': K.Equal,
    '[': K.BracketLeft,
    ']': K.BracketRight,
    ';': K.Semicolon,
    pageup: K.PageUp,
    pagedown: K.PageDown,
  };
  return map[key];
}

function monacoChord(monaco: Monaco, chord: KeyChord): number | undefined {
  const key = monacoKey(monaco, chord.key);
  if (key === undefined) return undefined;
  const M = monaco.KeyMod;
  return (chord.ctrl ? M.CtrlCmd : 0) | (chord.shift ? M.Shift : 0) | (chord.alt ? M.Alt : 0) | key;
}

let globalSetupDone = false;

/**
 * Integración única de Monaco con la app: atajos de specs/05 que faltan en
 * Monaco y acordes de la app (Ctrl+K S…) resueltos dentro del editor.
 */
function setupGlobal(monaco: Monaco): void {
  if (globalSetupDone) return;
  globalSetupDone = true;
  const M = monaco.KeyMod;
  const K = monaco.KeyCode;
  const chord = (a: number, b: number): number => M.chord(a, b);
  monaco.editor.addKeybindingRules([
    // Ctrl+Enter ejecuta la sentencia; "insertar línea debajo" pasa a Ctrl+Alt+Enter (specs/05).
    { keybinding: M.CtrlCmd | K.Enter, command: '-editor.action.insertLineAfter' },
    {
      keybinding: M.CtrlCmd | M.Alt | K.Enter,
      command: 'editor.action.insertLineAfter',
      when: 'editorTextFocus',
    },
    {
      keybinding: chord(M.CtrlCmd | K.KeyK, M.CtrlCmd | K.KeyU),
      command: 'editor.action.transformToUppercase',
      when: 'editorTextFocus',
    },
    {
      keybinding: chord(M.CtrlCmd | K.KeyK, M.CtrlCmd | K.KeyL),
      command: 'editor.action.transformToLowercase',
      when: 'editorTextFocus',
    },
  ]);

  // Acordes de la app (p. ej. Ctrl+K S = Guardar todo): dentro del editor los resuelve Monaco.
  // Se vuelven a registrar cada vez que cambian los atajos (keybindings.json).
  syncAppChords(monaco);
  useKeybindingsVersion.subscribe(() => syncAppChords(monaco));
}

let appChords: { dispose: () => void }[] = [];

/** Registra en Monaco los acordes vigentes de la app (los por defecto con los cambios del usuario aplicados). */
function syncAppChords(monaco: Monaco): void {
  for (const d of appChords) d.dispose();
  appChords = [];
  const M = monaco;
  const inEditor = new Set(['editorTextFocus']);
  for (const rule of keybindings.allRules()) {
    if (rule.sequence.length !== 2 || rule.command.startsWith('editor.')) continue;
    // Solo los que valen con el editor enfocado (no los de la grilla, el árbol…).
    if (!evaluateWhen(rule.when, inEditor)) continue;
    const first = monacoChord(M, rule.sequence[0]!);
    const second = monacoChord(M, rule.sequence[1]!);
    if (first === undefined || second === undefined) continue;
    const command = rule.command;
    const id = `app:${command}`;
    appChords.push(M.editor.registerCommand(id, () => void commands.execute(command)));
    appChords.push(M.editor.addKeybindingRule({ keybinding: M.KeyMod.chord(first, second), command: id }));
  }
}

let disposeRegistration: (() => void) | null = null;

/** Registra el editor como activo: contexto `editorTextFocus`, cursor y acciones de Monaco en la paleta. */
export function attachEditor(monaco: Monaco, editor: CodeEditor, group: EditorGroupIndex): () => void {
  setupGlobal(monaco);
  editors.set(group, editor);

  const disposers: (() => void)[] = [];
  disposers.push(registerContextProvider(() => (editor.hasTextFocus() ? ['editorTextFocus'] : [])));

  const updateCursor = (): void => {
    const selection = editor.getSelection();
    const model = editor.getModel();
    if (!selection || !model) return;
    const selected = selection.isEmpty() ? 0 : model.getValueLengthInRange(selection);
    useCursorStore.getState().set(selection.positionLineNumber, selection.positionColumn, selected);
  };
  // Solo el editor del grupo enfocado alimenta la status bar.
  const focused = (): boolean => activeEditor() === editor;
  const sub = editor.onDidChangeCursorSelection(() => focused() && updateCursor());
  const subModel = editor.onDidChangeModel(() => focused() && updateCursor());
  const subFocus = editor.onDidFocusEditorWidget(updateCursor);
  disposers.push(
    () => sub.dispose(),
    () => subModel.dispose(),
    () => subFocus.dispose(),
  );

  // Las acciones de Monaco se registran una vez (con el primer editor) y actúan sobre el enfocado.
  disposeRegistration ??= registerEditorActions(editor);

  return () => {
    disposers.forEach((d) => d());
    if (editors.get(group) === editor) editors.delete(group);
    if (editors.size === 0) {
      disposeRegistration?.();
      disposeRegistration = null;
    }
  };
}

/**
 * Las acciones de Monaco aparecen en la paleta con su id (`editor.action.*`)
 * para poder reasignarlas como en VS Code (specs/05 §Personalización).
 */
function registerEditorActions(editor: CodeEditor): () => void {
  const list = editor.getSupportedActions().map((action) => ({
    id: action.id,
    title: action.label,
    category: 'Editor',
    enabled: () => activeEditor()?.getModel() != null,
    run: () => {
      const target = activeEditor();
      target?.focus();
      void target?.getAction(action.id)?.run();
    },
  }));
  return commands.registerMany(list);
}
