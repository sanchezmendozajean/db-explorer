import type * as MonacoApi from 'monaco-editor/editor/editor.api';

export type EditorOptions = MonacoApi.editor.IEditorOptions & MonacoApi.editor.IGlobalEditorOptions;

/** Opciones por defecto de specs/05 (sobrescribibles con `editor.*` en settings.json). */
export const DEFAULT_OPTIONS: EditorOptions = {
  fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
  fontSize: 13,
  fontLigatures: false,
  tabSize: 4,
  insertSpaces: true,
  wordWrap: 'off',
  minimap: { enabled: false },
  renderWhitespace: 'selection',
  lineNumbers: 'on',
  cursorBlinking: 'smooth',
  smoothScrolling: true,
  bracketPairColorization: { enabled: true },
  guides: { indentation: true },
  folding: true,
  quickSuggestions: { other: true, comments: false, strings: false },
  suggestOnTriggerCharacters: true,
  acceptSuggestionOnEnter: 'on',
  formatOnPaste: false,
  stickyScroll: { enabled: false },
  multiCursorModifier: 'alt',
};

/** Convierte claves planas (`minimap.enabled`) en el objeto anidado que espera Monaco. */
function nestedOptions(flat: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let target = out;
    parts.slice(0, -1).forEach((p) => {
      target[p] = typeof target[p] === 'object' && target[p] !== null ? target[p] : {};
      target = target[p] as Record<string, unknown>;
    });
    target[parts[parts.length - 1]!] = value;
  }
  return out;
}

/** Opciones por defecto más las preferencias `editor.*` del usuario. */
export function editorOptions(settings: Record<string, unknown>): EditorOptions {
  return { ...DEFAULT_OPTIONS, ...nestedOptions(settings) };
}
