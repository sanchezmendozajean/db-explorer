import { useEffect, useRef } from 'react';
import type { ResultColumn } from '@shared/query';
import { IconButton } from '../../components/Button';
import { es } from '../../i18n/es';
import { useUiStore } from '../../stores/ui-store';
import { loadMonaco } from '../editor/monaco/loader';

/** Texto completo y lenguaje para el visor: JSON con sangría; XML detectado; resto texto plano. */
function presentation(column: ResultColumn, value: unknown): { text: string; language: string } {
  if (value === null || value === undefined) return { text: 'NULL', language: 'plaintext' };
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

/** Visor de valor (specs/04 §10): valor completo en Monaco de solo lectura. */
export function ValueViewer({
  column,
  value,
  onClose,
}: {
  column: ResultColumn;
  value: unknown;
  onClose: () => void;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useUiStore((s) => s.effectiveTheme);
  const { text, language } = presentation(column, value);

  useEffect(() => {
    let disposed = false;
    let dispose: (() => void) | undefined;
    void loadMonaco().then((monaco) => {
      if (disposed || !containerRef.current) return;
      const model = monaco.editor.createModel(text, language);
      const editor = monaco.editor.create(containerRef.current, {
        model,
        readOnly: true,
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
      dispose = () => {
        editor.dispose();
        model.dispose();
      };
    });
    return () => {
      disposed = true;
      dispose?.();
    };
  }, [text, language, theme]);

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
    </aside>
  );
}
