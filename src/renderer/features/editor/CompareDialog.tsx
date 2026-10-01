import { useEffect, useRef } from 'react';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { es } from '../../i18n/es';
import { useUiStore } from '../../stores/ui-store';
import { getDocument, reloadDocument, saveDocument } from './documents';
import { loadMonaco } from './monaco/loader';

/**
 * "Comparar" del aviso de cambio externo (specs/11 §4): a la izquierda el
 * archivo en disco, a la derecha el editor. Desde aquí se decide Sobrescribir
 * (queda lo del editor) o Recargar (queda lo del disco).
 */
export function CompareDialog({
  tabId,
  name,
  disk,
  onClose,
}: {
  tabId: string;
  name: string;
  disk: string;
  onClose: () => void;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useUiStore((s) => s.effectiveTheme);

  useEffect(() => {
    let disposed = false;
    let dispose: (() => void) | undefined;
    void loadMonaco().then((monaco) => {
      const doc = getDocument(tabId);
      if (disposed || !containerRef.current || !doc) return;
      const original = monaco.editor.createModel(disk, doc.model.getLanguageId());
      const diff = monaco.editor.createDiffEditor(containerRef.current, {
        readOnly: true,
        originalEditable: false,
        renderSideBySide: true,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
        fontSize: 12,
        theme: theme === 'light' ? 'db-light' : 'db-dark',
      });
      // El lado derecho es el modelo del propio editor: refleja lo que hay sin guardar.
      diff.setModel({ original, modified: doc.model });
      dispose = () => {
        diff.setModel(null);
        diff.dispose();
        original.dispose();
      };
    });
    return () => {
      disposed = true;
      dispose?.();
    };
  }, [tabId, disk, theme]);

  const run = (action: () => Promise<unknown>): void => {
    onClose();
    void action();
  };

  return (
    <Modal
      title={es.scripts.compareTitle(name)}
      onClose={onClose}
      width={960}
      footer={
        <>
          <Button variant="primary" onClick={() => run(() => saveDocument(tabId, { force: true }))}>
            {es.scripts.overwrite}
          </Button>
          <Button variant="secondary" onClick={() => run(() => reloadDocument(tabId))}>
            {es.scripts.reload}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {es.dialogs.close}
          </Button>
        </>
      }
    >
      <div className="compare-labels">
        <span>{es.scripts.compareDisk}</span>
        <span>{es.scripts.compareEditor}</span>
      </div>
      <div ref={containerRef} className="compare-editor" data-testid="compare-editor" />
    </Modal>
  );
}
