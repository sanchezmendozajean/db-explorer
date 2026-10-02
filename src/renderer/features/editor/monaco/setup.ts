/**
 * Carga e inicialización de Monaco (specs/05 §Integración). Se importa de
 * forma diferida para no pesar en el arranque. Todo va empaquetado: textos en
 * español, worker local y nada desde CDN.
 */
// Los textos en español deben cargarse antes que el editor.
import 'monaco-editor/nls/lang/es';
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/features/register.all';
import 'monaco-editor/languages/definitions/sql/register';
import 'monaco-editor/languages/definitions/pgsql/register';
import 'monaco-editor/languages/definitions/mysql/register';
// Otros archivos de texto del espacio de trabajo (specs/07).
import 'monaco-editor/languages/definitions/markdown/register';
import 'monaco-editor/languages/definitions/xml/register';
import 'monaco-editor/languages/definitions/yaml/register';
import 'monaco-editor/languages/definitions/javascript/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
// JSON con esquema (settings.json, keybindings.json y archivos .json del espacio de trabajo).
import { jsonDefaults } from 'monaco-editor/languages/features/json/register';
import JsonWorker from 'monaco-editor/languages/features/json/json.worker?worker';

export type Monaco = typeof monaco;

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

window.MonacoEnvironment = {
  getWorker: (_id, label) => (label === 'json' ? new JsonWorker() : new EditorWorker()),
};

export { jsonDefaults };

/** Temas a partir de los tokens de specs/04; el fondo coincide con `bg.editor`. */
monaco.editor.defineTheme('db-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: '569CD6' },
    { token: 'string', foreground: 'CE9178' },
    { token: 'number', foreground: 'B5CEA8' },
    { token: 'identifier.quote', foreground: '9CDCFE' },
    { token: 'predefined', foreground: 'DCDCAA' },
  ],
  colors: {
    'editor.background': '#1F1F1F',
    'editor.foreground': '#CCCCCC',
    'editor.lineHighlightBackground': '#282828',
    'editor.lineHighlightBorder': '#28282800',
    'editorLineNumber.foreground': '#6E7681',
    'editorLineNumber.activeForeground': '#CCCCCC',
    'editorCursor.foreground': '#AEAFAD',
    'editorGutter.background': '#1F1F1F',
    'editorWidget.background': '#202020',
    'editorWidget.border': '#454545',
    'editorSuggestWidget.background': '#202020',
    'editorSuggestWidget.border': '#454545',
    'editorHoverWidget.background': '#202020',
    'editorHoverWidget.border': '#454545',
    'input.background': '#313131',
    'input.border': '#3C3C3C',
    focusBorder: '#0078D4',
    'scrollbarSlider.background': '#79797966',
    'scrollbarSlider.hoverBackground': '#646464B3',
  },
});

monaco.editor.defineTheme('db-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '008000', fontStyle: 'italic' },
    { token: 'keyword', foreground: '0000FF' },
    { token: 'string', foreground: 'A31515' },
    { token: 'number', foreground: '098658' },
    { token: 'identifier.quote', foreground: '001080' },
    { token: 'predefined', foreground: '795E26' },
  ],
  colors: {
    'editor.background': '#FFFFFF',
    'editor.foreground': '#3B3B3B',
    'editor.lineHighlightBackground': '#EEEEEE',
    'editor.lineHighlightBorder': '#EEEEEE00',
    'editorLineNumber.foreground': '#6E7681',
    'editorLineNumber.activeForeground': '#171184',
    'editorCursor.foreground': '#000000',
    'editorGutter.background': '#FFFFFF',
    'editorWidget.background': '#F8F8F8',
    'editorWidget.border': '#CECECE',
    'input.background': '#FFFFFF',
    'input.border': '#CECECE',
    focusBorder: '#005FB8',
  },
});

export { monaco };
