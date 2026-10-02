import { useRef, useState } from 'react';
import type { ExportFormat } from '@shared/query';
import { Button } from '../../components/Button';
import { Checkbox, Select, TextInput } from '../../components/Inputs';
import { Modal } from '../../components/Modal';
import { es } from '../../i18n/es';

export interface ExportChoice {
  /** Filas cargadas o todas (re-ejecuta la consulta sin límite, en flujo). */
  all: boolean;
  separator: string;
  header: boolean;
  bom: boolean;
  table: string;
}

const t = es.results.exportDialog;

/** Opciones de una exportación a archivo (specs/06 §Otros formatos). */
export function ExportDialog({
  format,
  loaded,
  truncated,
  canRerun,
  defaultTable,
  onResult,
  onClose,
}: {
  format: ExportFormat;
  loaded: number;
  truncated: boolean;
  canRerun: boolean;
  defaultTable: string;
  onResult: (choice: ExportChoice | null) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [choice, setChoice] = useState<ExportChoice>({
    all: truncated && canRerun,
    separator: ',',
    header: true,
    bom: false,
    table: defaultTable,
  });
  const done = useRef(false);
  const finish = (value: ExportChoice | null): void => {
    if (done.current) return;
    done.current = true;
    onClose();
    onResult(value);
  };
  const set = <K extends keyof ExportChoice>(key: K, value: ExportChoice[K]): void =>
    setChoice((c) => ({ ...c, [key]: value }));

  return (
    <Modal
      title={t.title(format.toUpperCase())}
      onClose={() => finish(null)}
      width={460}
      footer={
        <>
          <Button variant="secondary" onClick={() => finish(null)}>
            {es.dialogs.cancel}
          </Button>
          <Button variant="primary" data-autofocus onClick={() => finish(choice)}>
            {t.export}
          </Button>
        </>
      }
    >
      {truncated && (
        <fieldset className="export-rows">
          <legend>{t.rows}</legend>
          <label className="radio">
            <input type="radio" checked={!choice.all} onChange={() => set('all', false)} />
            {t.loaded(loaded)}
          </label>
          <label className={['radio', canRerun ? '' : 'is-disabled'].join(' ')}>
            <input type="radio" checked={choice.all} disabled={!canRerun} onChange={() => set('all', true)} />
            {canRerun ? t.all : t.allUnavailable}
          </label>
        </fieldset>
      )}
      {format === 'csv' && (
        <div className="export-options">
          <label className="format-field">
            <span>{t.separator}</span>
            <Select
              value={choice.separator}
              onChange={(e) => set('separator', e.target.value)}
              options={[
                { value: ',', label: t.separators.comma },
                { value: ';', label: t.separators.semicolon },
                { value: '\t', label: t.separators.tab },
                { value: '|', label: t.separators.pipe },
              ]}
            />
          </label>
          <Checkbox
            label={t.header}
            checked={choice.header}
            onChange={(e) => set('header', e.target.checked)}
          />
          <Checkbox label={t.bom} checked={choice.bom} onChange={(e) => set('bom', e.target.checked)} />
        </div>
      )}
      {format === 'sql' && (
        <label className="format-field">
          <span>{t.table}</span>
          <TextInput value={choice.table} onChange={(e) => set('table', e.target.value)} />
        </label>
      )}
    </Modal>
  );
}
