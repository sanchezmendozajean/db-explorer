import { create } from 'zustand';
import type * as MonacoApi from 'monaco-editor/editor/editor.api';
import type { KeyChord } from '../../commands/keybindings';
import { commands, keybindings, registerContextProvider } from '../../commands/service';
import { DEFAULT_KEYBINDINGS } from '../../commands/default-keybindings';
import { parseKeybinding } from '../../commands/keybindings';
import type { Monaco } from './monaco/loader';

export type CodeEditor = MonacoApi.editor.IStandaloneCodeEditor;

let current: CodeEditor | null = null;

/** Editor Monaco del grupo (uno solo; cambiar de pestaña = `setModel`). */
export function activeEditor(): CodeEditor | null {
  return current;
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
  for (const rule of DEFAULT_KEYBINDINGS) {
    let sequence: KeyChord[];
    try {
      sequence = parseKeybinding(rule.key);
    } catch {
      continue;
    }
    if (sequence.length !== 2 || rule.command.startsWith('editor.')) continue;
    const first = monacoChord(monaco, sequence[0]!);
    const second = monacoChord(monaco, sequence[1]!);
    if (first === undefined || second === undefined) continue;
    const command = rule.command;
    monaco.editor.registerCommand(`app:${command}`, () => void commands.execute(command));
    monaco.editor.addKeybindingRule({ keybinding: chord(first, second), command: `app:${command}` });
  }
}

let disposeRegistration: (() => void) | null = null;

/** Registra el editor como activo: contexto `editorTextFocus`, cursor y acciones de Monaco en la paleta. */
export function attachEditor(monaco: Monaco, editor: CodeEditor): () => void {
  setupGlobal(monaco);
  current = editor;

  const disposers: (() => void)[] = [];
  disposers.push(registerContextProvider(() => (editor.hasTextFocus() ? ['editorTextFocus'] : [])));

  const updateCursor = (): void => {
    const selection = editor.getSelection();
    const model = editor.getModel();
    if (!selection || !model) return;
    const selected = selection.isEmpty() ? 0 : model.getValueLengthInRange(selection);
    useCursorStore.getState().set(selection.positionLineNumber, selection.positionColumn, selected);
  };
  const sub = editor.onDidChangeCursorSelection(updateCursor);
  const subModel = editor.onDidChangeModel(updateCursor);
  disposers.push(
    () => sub.dispose(),
    () => subModel.dispose(),
  );

  disposeRegistration?.();
  disposeRegistration = registerEditorActions(editor);
  disposers.push(() => {
    disposeRegistration?.();
    disposeRegistration = null;
  });

  return () => {
    disposers.forEach((d) => d());
    if (current === editor) current = null;
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
    enabled: () => current !== null && current.getModel() !== null,
    run: () => {
      editor.focus();
      void editor.getAction(action.id)?.run();
    },
  }));
  return commands.registerMany(list);
}

/** Atajo de la app para un comando, en formato de Monaco (menú contextual del editor). */
export function appKeybinding(monaco: Monaco, command: string): number | undefined {
  const sequence = keybindings.lookup(command);
  if (!sequence || sequence.length !== 1) return undefined;
  return monacoChord(monaco, sequence[0]!);
}
