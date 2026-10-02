import { useEffect, useLayoutEffect, useRef } from 'react';
import type * as MonacoApi from 'monaco-editor/editor/editor.api';
import type { Engine } from '@shared/connection';
import { useUiStore } from '../../stores/ui-store';
import { languageFor } from '../editor/documents';
import { loadMonaco } from '../editor/monaco/loader';
import { registerSqlProviders } from '../editor/monaco/providers';
import { registerClauseModel } from '../editor/sql-intellisense';

/**
 * Campo de una línea con Monaco en modo SQL para el WHERE y el ORDER BY de
 * la pestaña de objeto (specs/04 §9), con autocompletado de columnas.
 * Enter ejecuta (salvo con la lista de sugerencias abierta).
 */
export function ClauseEditor({
  tabId,
  clause,
  engine,
  value,
  label,
  onChange,
  onSubmit,
}: {
  tabId: string;
  clause: 'where' | 'order';
  engine: Engine | undefined;
  value: string;
  label: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useUiStore((s) => s.effectiveTheme);
  const latest = useRef({ onChange, onSubmit });
  useLayoutEffect(() => {
    latest.current = { onChange, onSubmit };
  });
  const initial = useRef(value);
  const modelRef = useRef<MonacoApi.editor.ITextModel | null>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void loadMonaco().then((monaco) => {
      if (disposed || !containerRef.current) return;
      registerSqlProviders(monaco);
      const model = monaco.editor.createModel(initial.current, languageFor(engine));
      registerClauseModel(model, { tabId, clause });
      modelRef.current = model;
      const editor = monaco.editor.create(containerRef.current, {
        model,
        fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
        fontSize: 12,
        lineHeight: 20,
        lineNumbers: 'off',
        glyphMargin: false,
        folding: false,
        lineDecorationsWidth: 4,
        lineNumbersMinChars: 0,
        minimap: { enabled: false },
        scrollbar: { vertical: 'hidden', horizontal: 'hidden', alwaysConsumeMouseWheel: false },
        overviewRulerLanes: 0,
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        renderLineHighlight: 'none',
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        contextmenu: false,
        fixedOverflowWidgets: true,
        automaticLayout: true,
        quickSuggestions: { other: true, comments: false, strings: false },
        suggestOnTriggerCharacters: true,
        theme: document.documentElement.dataset['theme'] === 'light' ? 'db-light' : 'db-dark',
        ariaLabel: label,
      });
      // Una sola línea: los saltos de línea pegados se convierten en espacios.
      const change = model.onDidChangeContent(() => {
        const text = model.getValue();
        if (/[\r\n]/.test(text)) {
          model.setValue(text.replace(/\r?\n/g, ' '));
          return;
        }
        latest.current.onChange(text);
      });
      editor.addCommand(monaco.KeyCode.Enter, () => latest.current.onSubmit(), '!suggestWidgetVisible');
      cleanup = () => {
        modelRef.current = null;
        change.dispose();
        editor.dispose();
        model.dispose();
      };
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [tabId, clause, engine, label]);

  // Cambios desde fuera (p. ej. "Ordenar en servidor" escribe el ORDER BY).
  useEffect(() => {
    const model = modelRef.current;
    if (model && model.getValue() !== value) model.setValue(value);
    initial.current = value;
  }, [value]);

  useEffect(() => {
    void loadMonaco().then((monaco) => monaco.editor.setTheme(theme === 'light' ? 'db-light' : 'db-dark'));
  }, [theme]);

  return <div ref={containerRef} className="clause-editor" data-testid={`clause-${clause}`} />;
}
