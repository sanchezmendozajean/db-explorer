import { useEffect, useRef, useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Inputs';
import { es } from '../../i18n/es';
import type { ChoiceButton } from '../../stores/overlay-store';
import { monacoIfLoaded } from '../editor/monaco/loader';

/** Llama a `resolve` una sola vez, aunque el diálogo se cierre por varios caminos. */
function useOnce<T>(resolve: (value: T) => void): (value: T) => void {
  const done = useRef(false);
  return (value: T) => {
    if (done.current) return;
    done.current = true;
    resolve(value);
  };
}

export function ChoiceDialog({
  title,
  message,
  items,
  buttons,
  onResult,
  onClose,
}: {
  title: string;
  message: string;
  items?: string[];
  buttons: ChoiceButton[];
  onResult: (value: string | null) => void;
  onClose: () => void;
}): React.JSX.Element {
  const finish = useOnce(onResult);
  const choose = (value: string | null): void => {
    onClose();
    finish(value);
  };
  return (
    <Modal
      title={title}
      onClose={() => choose(null)}
      width={460}
      footer={buttons.map((b, i) => (
        <Button
          key={b.value}
          variant={b.variant ?? 'secondary'}
          data-autofocus={i === 0 || undefined}
          onClick={() => choose(b.value)}
        >
          {b.label}
        </Button>
      ))}
    >
      <p>{message}</p>
      {items && items.length > 0 && (
        <ul className="dialog-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Máximo de líneas de la vista previa de sentencias (specs/04 §14). */
const PREVIEW_LINES = 8;

function SqlPreview({
  sql,
  language,
  maxLines = PREVIEW_LINES,
}: {
  sql: string;
  language: string;
  maxLines?: number;
}): React.JSX.Element {
  const [html, setHtml] = useState<string | null>(null);
  const text = sql.split('\n').slice(0, maxLines).join('\n');
  useEffect(() => {
    let alive = true;
    const monaco = monacoIfLoaded();
    // `colorize` de Monaco devuelve HTML con el texto ya escapado.
    void monaco?.editor.colorize(text, language, { tabSize: 4 }).then((h) => alive && setHtml(h));
    return () => {
      alive = false;
    };
  }, [text, language]);
  return html === null ? (
    <pre className="sql-preview">{text}</pre>
  ) : (
    <pre className="sql-preview" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

export function WriteConfirmDialog({
  connectionName,
  production,
  statements,
  unbounded,
  language,
  allowSkip = true,
  rollbackNote = false,
  onResult,
  onClose,
}: {
  connectionName: string;
  production: boolean;
  statements: string[];
  unbounded: boolean;
  language: string;
  /** Mostrar "No volver a preguntar en esta pestaña" (no al guardar ediciones de la grilla). */
  allowSkip?: boolean;
  /** Explicar y ejecutar: la sentencia se mide y se revierte (specs/12 §4). */
  rollbackNote?: boolean;
  onResult: (result: { confirmed: boolean; dontAskAgain: boolean }) => void;
  onClose: () => void;
}): React.JSX.Element {
  const t = es.execution.confirm;
  const [dontAsk, setDontAsk] = useState(false);
  const finish = useOnce(onResult);
  const close = (confirmed: boolean): void => {
    onClose();
    finish({ confirmed, dontAskAgain: confirmed && dontAsk });
  };
  return (
    <Modal
      title={production ? t.productionTitle : t.unboundedTitle}
      onClose={() => close(false)}
      width={560}
      accentColor="var(--error)"
      footer={
        <>
          {/* Cancelar tiene el foco por defecto. */}
          <Button variant="secondary" data-autofocus onClick={() => close(false)}>
            {es.dialogs.cancel}
          </Button>
          <Button variant="danger" onClick={() => close(true)}>
            {t.execute}
          </Button>
        </>
      }
    >
      {production && (
        <p>
          {t.productionBefore(statements.length)}
          <strong>{connectionName}</strong>
          {t.productionAfter}
        </p>
      )}
      {unbounded && <p className="dialog-warning">{t.unbounded}</p>}
      {rollbackNote && <p>{es.plan.rollbackNote}</p>}
      <SqlPreview sql={statements.join(';\n\n')} language={language} />
      {production && allowSkip && (
        <Checkbox label={t.dontAskAgain} checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
      )}
    </Modal>
  );
}

/** Vista previa de las sentencias a guardar de la grilla (specs/04 §14): Cancelar / Aplicar. */
export function SqlPreviewDialog({
  statements,
  language,
  onResult,
  onClose,
}: {
  statements: string[];
  language: string;
  onResult: (apply: boolean) => void;
  onClose: () => void;
}): React.JSX.Element {
  const finish = useOnce(onResult);
  const close = (apply: boolean): void => {
    onClose();
    finish(apply);
  };
  return (
    <Modal
      title={es.results.edit.previewTitle}
      onClose={() => close(false)}
      width={720}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)}>
            {es.dialogs.cancel}
          </Button>
          <Button variant="primary" data-autofocus onClick={() => close(true)}>
            {es.results.edit.apply}
          </Button>
        </>
      }
    >
      <p>{es.results.edit.previewMessage(statements.length)}</p>
      <div className="sql-preview-scroll" data-testid="sql-preview">
        <SqlPreview sql={statements.join('\n')} language={language} maxLines={Infinity} />
      </div>
    </Modal>
  );
}
