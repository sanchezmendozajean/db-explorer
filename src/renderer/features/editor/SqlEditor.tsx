import { useEffect, useRef, useState } from 'react';
import type * as MonacoApi from 'monaco-editor/editor/editor.api';
import { splitStatements, statementAt } from '@shared/splitter';
import { es } from '../../i18n/es';
import { showContextMenu } from '../../components/ContextMenuHost';
import { connectionById } from '../../stores/connections-store';
import { useSettingsStore } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import type { EditorTab } from '../../stores/workbench-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import { EMPTY_TAB_RESULTS, useResultsStore } from '../results/results-store';
import { clearMarkers, dialectOf } from '../execution/execute';
import type { ScriptDocument } from './documents';
import { ensureDocument, getDocument, onDocumentChange } from './documents';
import type { CodeEditor } from './editor-instance';
import { attachEditor } from './editor-instance';
import { editorContextMenu } from './editor-menu';
import { loadMonaco } from './monaco/loader';
import type { Monaco } from './monaco/loader';
import { scheduleWorkspaceSave } from './scripts';

/** Opciones por defecto de specs/05 (sobrescribibles con `editor.*` en settings.json). */
const DEFAULT_OPTIONS: MonacoApi.editor.IEditorOptions & MonacoApi.editor.IGlobalEditorOptions = {
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

const ACTIVE_STATEMENT_DEBOUNCE_MS = 150;

/** Editor SQL del grupo: una instancia de Monaco; cada pestaña aporta su modelo (specs/05 §Integración). */
export function SqlEditor({ tab }: { tab: EditorTab }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [instance, setInstance] = useState<{ monaco: Monaco; editor: CodeEditor } | null>(null);
  const theme = useUiStore((s) => s.effectiveTheme);
  const editorSettings = useSettingsStore((s) => s.settings.editor);
  const docRef = useRef<ScriptDocument | null>(null);
  const [doc, setDoc] = useState<ScriptDocument | null>(null);
  const outcomes = useResultsStore((s) => (s.byTab[tab.id] ?? EMPTY_TAB_RESULTS).outcomes);

  // Crea el editor una sola vez.
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void loadMonaco().then((monaco) => {
      if (disposed || !containerRef.current) return;
      const editor = monaco.editor.create(containerRef.current, {
        ...DEFAULT_OPTIONS,
        model: null,
        automaticLayout: true,
        glyphMargin: true,
        fixedOverflowWidgets: true,
        theme: document.documentElement.dataset['theme'] === 'light' ? 'db-light' : 'db-dark',
        ariaLabel: es.editor.ariaLabel,
        contextmenu: false,
      });
      const detach = attachEditor(monaco, editor);
      // Menú contextual propio (ver editor-menu.ts); el de Monaco queda desactivado.
      const menu = editor.onContextMenu((e) =>
        showContextMenu(e.event.browserEvent, editorContextMenu(editor), {
          restoreFocus: () => editor.focus(),
        }),
      );
      setInstance({ monaco, editor });
      cleanup = () => {
        // Se conserva la posición del documento visible al desmontar.
        const current = docRef.current;
        if (current && editor.getModel() === current.model) current.viewState = editor.saveViewState();
        menu.dispose();
        detach();
        editor.dispose();
      };
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  // Tema y opciones.
  useEffect(() => {
    instance?.monaco.editor.setTheme(theme === 'light' ? 'db-light' : 'db-dark');
  }, [instance, theme]);
  useEffect(() => {
    instance?.editor.updateOptions({
      ...DEFAULT_OPTIONS,
      ...nestedOptions(editorSettings),
      contextmenu: false,
    });
  }, [instance, editorSettings]);

  // Modelo de la pestaña activa: guarda el viewState de la anterior y restaura el de la nueva.
  // Depende solo del id: otros cambios de la pestaña (p. ej. el ● de cambios) no deben robar el foco.
  const tabId = tab.id;
  useEffect(() => {
    const current = useWorkbenchStore.getState().tabs.find((t) => t.id === tabId);
    if (!instance || !current) return;
    let alive = true;
    void ensureDocument(current).then((next) => {
      if (!alive || !next) return;
      const { editor } = instance;
      const previous = docRef.current;
      if (previous && previous !== next && editor.getModel() === previous.model) {
        previous.viewState = editor.saveViewState();
      }
      docRef.current = next;
      setDoc(next);
      if (editor.getModel() === next.model) return;
      editor.setModel(next.model);
      if (next.viewState) editor.restoreViewState(next.viewState);
      // Al cambiar de pestaña el foco pasa al editor solo si estaba en el grupo de editor (o en ninguna parte):
      // no se lo quita a un menú, la paleta, un diálogo o el árbol.
      const active = document.activeElement;
      if (!active || active === document.body || active.closest('.editor-group')) editor.focus();
    });
    return () => {
      alive = false;
    };
  }, [instance, tabId]);

  // viewState al mover el cursor o desplazarse (para restaurar al reabrir la app).
  useEffect(() => {
    if (!instance || !doc) return;
    const { editor } = instance;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const remember = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (editor.getModel() === doc.model) {
          doc.viewState = editor.saveViewState();
          scheduleWorkspaceSave();
        }
      }, 500);
    };
    const a = editor.onDidChangeCursorPosition(remember);
    const b = editor.onDidScrollChange(remember);
    return () => {
      clearTimeout(timer);
      a.dispose();
      b.dispose();
    };
  }, [instance, doc]);

  // Sentencia activa: fondo sutil y barra en el margen (specs/04 §8), con 150 ms de retardo.
  const engine = connectionById(tab.connectionId)?.engine;
  const separator = useSettingsStore((s) => s.settings['sql.statementSeparator']);
  useEffect(() => {
    if (!instance || !doc) return;
    const { monaco, editor } = instance;
    const decorations = editor.createDecorationsCollection();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = (): void => {
      const model = editor.getModel();
      const position = editor.getPosition();
      if (!model || model !== doc.model || !position) return decorations.clear();
      const text = model.getValue();
      const statement = statementAt(
        text,
        splitStatements(text, dialectOf(engine), { blankLineSeparator: separator === 'blankLine' }),
        model.getOffsetAt(position),
      );
      if (!statement) return decorations.clear();
      const start = model.getPositionAt(statement.start);
      const end = model.getPositionAt(statement.end);
      decorations.set([
        {
          range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
          options: {
            isWholeLine: true,
            className: 'active-statement',
            linesDecorationsClassName: 'active-statement-gutter',
          },
        },
      ]);
    };
    const schedule = (): void => {
      clearTimeout(timer);
      timer = setTimeout(update, ACTIVE_STATEMENT_DEBOUNCE_MS);
    };
    update();
    const a = editor.onDidChangeCursorPosition(schedule);
    const b = editor.onDidChangeModelContent(schedule);
    return () => {
      clearTimeout(timer);
      a.dispose();
      b.dispose();
      decorations.clear();
    };
  }, [instance, doc, engine, separator]);

  // Íconos de resultado por sentencia en el gutter; se limpian al editar (specs/04 §8).
  useEffect(() => {
    if (!instance || !doc) return;
    const decorations = instance.editor.createDecorationsCollection(
      outcomes.map((o) => ({
        range: new instance.monaco.Range(o.line, 1, o.line, 1),
        options: {
          glyphMarginClassName: `codicon ${o.ok ? 'codicon-pass statement-ok' : 'codicon-error statement-error'}`,
          glyphMarginHoverMessage: { value: o.ok ? es.execution.statementOk : es.execution.statementFailed },
        },
      })),
    );
    return () => decorations.clear();
  }, [instance, doc, outcomes]);

  useEffect(
    () =>
      onDocumentChange((changed) => {
        if (getDocument(changed.tabId) === changed) clearMarkers(changed.tabId);
      }),
    [],
  );

  return (
    <div
      ref={containerRef}
      className="sql-editor"
      data-focus-context="editorFocus"
      data-testid="sql-editor"
    />
  );
}
