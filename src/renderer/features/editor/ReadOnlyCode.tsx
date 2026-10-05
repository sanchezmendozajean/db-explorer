import { useEffect, useRef } from 'react';
import { useUiStore } from '../../stores/ui-store';
import { loadMonaco } from './monaco/loader';

/** Texto en Monaco de solo lectura con resaltado (Ver original del plan). */
export function ReadOnlyCode({
  text,
  language,
  ariaLabel,
  testId,
}: {
  text: string;
  language: string;
  ariaLabel: string;
  testId?: string;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useUiStore((s) => s.effectiveTheme);

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
        folding: true,
        automaticLayout: true,
        scrollBeyondLastLine: false,
        contextmenu: false,
        fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
        fontSize: 12,
        theme: theme === 'light' ? 'db-light' : 'db-dark',
        ariaLabel,
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
  }, [text, language, theme, ariaLabel]);

  return <div ref={containerRef} className="read-only-code" data-testid={testId} data-language={language} />;
}
