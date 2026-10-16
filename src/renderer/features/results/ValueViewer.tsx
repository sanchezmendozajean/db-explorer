import { useEffect, useLayoutEffect, useRef } from 'react';
import type { editor as MonacoEditor } from 'monaco-editor';
import type { CellValue, ResultColumn } from '@shared/query';
import { Button, IconButton } from '../../components/Button';
import { es } from '../../i18n/es';
import { useUiStore } from '../../stores/ui-store';
import { loadMonaco } from '../editor/monaco/loader';
import type { RowRef } from './edit-state';

/** Valor que se muestra en el visor; `target` está si la celda se puede editar (specs/04 §10). */
export interface ViewedValue {
  column: ResultColumn;
  value: unknown;
  target?: { ref: RowRef; column: number };
}

/** Texto completo y lenguaje para el visor: JSON con sangría; XML detectado; resto texto plano. */
function presentation(
  column: ResultColumn,
  value: unknown,
  editable: boolean,
): { text: string; language: string } {
  // En una celda editable el NULL se muestra como un editor vacío (el botón "NULL" lo establece).
  if (value === null || value === undefined) return { text: editable ? '' : 'NULL', language: 'plaintext' };
  const text = String(value);
  if (column.logicalType === 'json' || /^\s*[[{]/.test(text)) {
    try {
      return { text: JSON.stringify(JSON.parse(text), null, 2), language: 'json' };
    } catch {
      // No era JSON válido: se muestra tal cual.
    }
  }
  if (/^\s*<[^>]+>/.test(text)) return { text, language: 'xml' };
  return { text, language: 'plaintext' };
}

/**
 * Visor de valor (specs/04 §10): valor completo en Monaco. Si la celda es editable, el texto se
 * puede cambiar y se aplica como cualquier otra edición de la grilla (cambio pendiente, sin guardar).
 */
export function ValueViewer({
  viewed,
  onApply,
  onClose,
}: {
  viewed: ViewedValue;
  /** Aplica el texto (o `null`) a la celda; solo se llama si `viewed.target` existe. */
  onApply: (value: CellValue) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { column, value } = viewed;
  const editable = viewed.target !== undefined;
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const theme = useUiStore((s) => s.effectiveTheme);
  const { text, language } = presentation(column, value, editable);
  const wasNull = value === null || value === undefined;
  const apply = useRef<() => void>(() => undefined);

  // Aplica el texto actual: un editor vacío sobre una celda NULL no la convierte en texto vacío.
  useLayoutEffect(() => {
    apply.current = () => {
      const current = editorRef.current?.getValue() ?? '';
      if (current === '' && wasNull) return;
      onApply(current);
    };
  });

  useEffect(() => {
    let disposed = false;
    let dispose: (() => void) | undefined;
    void loadMonaco().then((monaco) => {
      if (disposed || !containerRef.current) return;
      const model = monaco.editor.createModel(text, language);
      const editor = monaco.editor.create(containerRef.current, {
        model,
        readOnly: !editable,
        minimap: { enabled: false },
        lineNumbers: 'off',
        wordWrap: 'on',
        folding: true,
        automaticLayout: true,
        scrollBeyondLastLine: false,
        fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
        fontSize: 12,
        theme: theme === 'light' ? 'db-light' : 'db-dark',
      });
      editorRef.current = editor;
      if (editable) {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => apply.current());
      }
      dispose = () => {
        editorRef.current = null;
        editor.dispose();
        model.dispose();
      };
    });
    return () => {
      disposed = true;
      dispose?.();
    };
  }, [text, language, theme, editable]);

  return (
    <aside className="value-viewer" aria-label={es.results.valueViewer} data-testid="value-viewer">
      <div className="value-viewer-header">
        <span className="value-viewer-title" title={column.nativeType}>
          {column.name}
          <span className="muted"> · {column.nativeType || column.logicalType}</span>
        </span>
        <IconButton icon="close" label={es.dialogs.close} onClick={onClose} />
      </div>
      <div ref={containerRef} className="value-viewer-editor" />
      {editable && (
        <div className="value-viewer-footer">
          <Button small onClick={() => apply.current()} data-testid="value-apply">
            {es.results.valueApply}
          </Button>
          <Button small variant="secondary" onClick={() => onApply(null)} data-testid="value-null">
            {es.results.valueSetNull}
          </Button>
        </div>
      )}
    </aside>
  );
}
