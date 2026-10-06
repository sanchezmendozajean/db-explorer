import { useEffect, useRef, useState } from 'react';
import type { CellValue, ResultColumn } from '@shared/query';
import type { ColumnFormat } from '@shared/settings';
import { Button } from '../../components/Button';
import { Checkbox, Select, TextInput } from '../../components/Inputs';
import { es } from '../../i18n/es';
import type { FormatSettings } from './format';
import { formatCell, withColumnFormat } from './format';

/**
 * Formato de columna desde la grilla (specs/06 §Formato por columna): popover
 * de 280 px con los controles del tipo de la columna, alineación y vista
 * previa con el valor de la celda seleccionada.
 */

const t = es.results.format;

interface Props {
  /** Formato sobre el que se aplica el de la columna (global y de la conexión). */
  base: FormatSettings;
  column: ResultColumn;
  /** Valor de ejemplo (la celda seleccionada). */
  sample: CellValue;
  initial: ColumnFormat | undefined;
  /** Clave para recordar (`tabla.columna`); sin valor no se puede recordar. */
  rememberLabel: string | null;
  remembered: boolean;
  x: number;
  y: number;
  onApply: (format: ColumnFormat | null, remember: boolean) => void;
  onClose: () => void;
}

function opts<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
): { value: T; label: string }[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

export function ColumnFormatPopover({
  base: settings,
  column,
  sample,
  initial,
  rememberLabel,
  remembered,
  x,
  y,
  onApply,
  onClose,
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState<ColumnFormat>(initial ?? {});
  const [remember, setRemember] = useState(remembered);
  const ref = useRef<HTMLDivElement>(null);
  const type = column.logicalType;
  const set = <K extends keyof ColumnFormat>(key: K, value: ColumnFormat[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('select, input')?.focus();
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [onClose]);

  const effective = withColumnFormat(settings, draft);
  const preview = sample === null ? settings['format.null'] : formatCell(sample, type, effective);
  const numeric = type === 'integer' || type === 'decimal' || type === 'float';

  const field = (label: string, control: React.ReactNode): React.JSX.Element => (
    <label className="format-field">
      <span>{label}</span>
      {control}
    </label>
  );

  // Que no se salga de la ventana.
  const left = Math.min(x, window.innerWidth - 296);
  const top = Math.min(y, window.innerHeight - 360);

  return (
    <div
      ref={ref}
      className="format-popover"
      role="dialog"
      aria-label={t.title(column.name)}
      style={{ left, top }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="format-title">{t.title(column.name)}</div>
      {type === 'decimal' &&
        field(
          t.decimalMode,
          <Select
            value={draft['decimal.mode'] ?? settings['format.decimal.mode']}
            onChange={(e) => set('decimal.mode', e.target.value as ColumnFormat['decimal.mode'])}
            options={opts(['asStored', 'fixed', 'trimZeros'] as const, t.decimalModes)}
          />,
        )}
      {type === 'decimal' &&
        (draft['decimal.mode'] ?? settings['format.decimal.mode']) === 'fixed' &&
        field(
          t.decimalPlaces,
          <TextInput
            type="number"
            min={0}
            max={30}
            value={draft['decimal.places'] ?? settings['format.decimal.places']}
            onChange={(e) => set('decimal.places', Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
          />,
        )}
      {type === 'float' &&
        field(
          t.floatDigits,
          <TextInput
            type="number"
            min={1}
            max={17}
            value={draft['float.maxDigits'] ?? settings['format.float.maxDigits']}
            onChange={(e) => set('float.maxDigits', Math.max(1, Math.min(17, Number(e.target.value) || 1)))}
          />,
        )}
      {numeric && (
        <Checkbox
          label={t.thousands}
          checked={draft['number.thousandsSeparator'] ?? settings['format.number.thousandsSeparator']}
          onChange={(e) => set('number.thousandsSeparator', e.target.checked)}
        />
      )}
      {type === 'date' &&
        field(
          t.pattern,
          <TextInput
            value={draft.date ?? settings['format.date']}
            onChange={(e) => set('date', e.target.value)}
          />,
        )}
      {type === 'time' &&
        field(
          t.pattern,
          <TextInput
            value={draft.time ?? settings['format.time']}
            onChange={(e) => set('time', e.target.value)}
          />,
        )}
      {(type === 'datetime' || type === 'datetimetz') && (
        <>
          {field(
            t.pattern,
            <TextInput
              value={draft.datetime ?? settings['format.datetime']}
              onChange={(e) => set('datetime', e.target.value)}
            />,
          )}
          {field(
            t.millis,
            <Select
              value={draft['datetime.showMillis'] ?? settings['format.datetime.showMillis']}
              onChange={(e) =>
                set('datetime.showMillis', e.target.value as ColumnFormat['datetime.showMillis'])
              }
              options={opts(['whenPresent', 'always', 'never'] as const, t.millisModes)}
            />,
          )}
        </>
      )}
      {type === 'datetimetz' &&
        field(
          t.zone,
          <Select
            value={draft['datetimetz.display'] ?? settings['format.datetimetz.display']}
            onChange={(e) => set('datetimetz.display', e.target.value as ColumnFormat['datetimetz.display'])}
            options={opts(['asStored', 'local', 'utc'] as const, t.zones)}
          />,
        )}
      {type === 'boolean' &&
        field(
          t.boolean,
          <Select
            value={draft.boolean ?? settings['format.boolean']}
            onChange={(e) => set('boolean', e.target.value as ColumnFormat['boolean'])}
            options={opts(['checkbox', 'true/false', '1/0', 'sí/no'] as const, t.booleans)}
          />,
        )}
      {type === 'binary' &&
        field(
          t.binary,
          <Select
            value={draft.binary ?? settings['format.binary']}
            onChange={(e) => set('binary', e.target.value as ColumnFormat['binary'])}
            options={opts(['hex', 'base64', 'size'] as const, t.binaries)}
          />,
        )}
      {field(
        t.align,
        <Select
          value={draft.align ?? ''}
          onChange={(e) => set('align', (e.target.value || undefined) as ColumnFormat['align'])}
          options={[
            { value: '', label: t.alignDefault },
            ...opts(['left', 'right', 'center'] as const, t.aligns),
          ]}
        />,
      )}
      <div className="format-preview" data-testid="format-preview">
        <span>{t.preview}</span>
        <code>{preview}</code>
      </div>
      <Checkbox
        label={rememberLabel ? t.remember(rememberLabel) : t.rememberUnavailable}
        disabled={!rememberLabel}
        checked={remember && !!rememberLabel}
        onChange={(e) => setRemember(e.target.checked)}
      />
      <div className="format-actions">
        <Button variant="secondary" small onClick={() => onApply(null, remember)}>
          {t.reset}
        </Button>
        <Button
          small
          onClick={() => onApply(Object.keys(draft).length > 0 ? draft : null, remember && !!rememberLabel)}
        >
          {t.apply}
        </Button>
      </div>
    </div>
  );
}
