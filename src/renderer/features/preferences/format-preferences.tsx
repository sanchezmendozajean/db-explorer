import type { CellValue, LogicalType } from '@shared/query';
import type { ColumnFormat, SettingKey, Settings } from '@shared/settings';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { withoutKey } from '@shared/records';
import { Checkbox, Select } from '../../components/Inputs';
import { es } from '../../i18n/es';
import { useSettingsStore } from '../../stores/settings-store';
import { formatCell, withConnectionFormat } from '../results/format';
import type { PrefEntry } from './pref-controls';
import { intInRange } from './pref-search';
import { CommitInput } from './pref-controls';

/**
 * Preferencias › Formatos de datos (specs/06): una fila por tipo con sus
 * controles, vista previa en vivo y "Restablecer". Con una conexión elegida en
 * "Aplicar a", los cambios se guardan como formato de esa conexión
 * (`format.connections`, nivel 2) y lo que no cambie usa el global.
 */

type FormatSettingKey = Extract<SettingKey, `format.${string}`>;
/** Claves `format.*` que también puede tener una conexión (las de `ColumnFormat`, sin el prefijo). */
type ScopedKey = Exclude<keyof ColumnFormat, 'align'>;

const GLOBAL_ONLY = new Set<FormatSettingKey>([
  'format.locale',
  'format.number.decimalSeparator',
  'format.null',
  'format.binary.maxBytes',
  'format.text.maxLength',
]);

const DATE_PRESETS = ['yyyy-MM-dd', 'dd/MM/yyyy', 'MM/dd/yyyy', 'dd-MM-yyyy', 'dd.MM.yyyy'] as const;
const TIME_PRESETS = ['HH:mm:ss', 'HH:mm'] as const;
const DATETIME_PRESETS = [
  'yyyy-MM-dd HH:mm:ss',
  'dd/MM/yyyy HH:mm:ss',
  'MM/dd/yyyy HH:mm:ss',
  'yyyy-MM-dd HH:mm',
] as const;

function opts<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
): { value: T; label: string }[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

const shortKey = (key: FormatSettingKey): ScopedKey => key.slice('format.'.length) as ScopedKey;

/** Controles de los formatos para el alcance elegido (`null` = todas las conexiones). */
export function formatEntries(
  global: Settings,
  scope: string | null,
  setScope: (scope: string | null) => void,
  connections: { id: string; name: string }[],
): PrefEntry[] {
  const t = es.preferences.formats;
  const f = es.results.format;
  const store = useSettingsStore.getState();
  const override: ColumnFormat = scope ? (global['format.connections'][scope] ?? {}) : {};
  const effective = withConnectionFormat(global, scope ?? undefined);

  const value = <K extends FormatSettingKey>(key: K): Settings[K] => effective[key];
  const disabled = (key: FormatSettingKey): boolean => scope !== null && GLOBAL_ONLY.has(key);
  const set = <K extends FormatSettingKey>(key: K, next: Settings[K]): void => {
    if (scope === null) {
      void store.update(key, next);
      return;
    }
    if (GLOBAL_ONLY.has(key)) return;
    const all = global['format.connections'];
    void store.update('format.connections', { ...all, [scope]: { ...override, [shortKey(key)]: next } });
  };
  const isModified = (keys: FormatSettingKey[]): boolean =>
    scope === null
      ? keys.some((k) => JSON.stringify(global[k]) !== JSON.stringify(DEFAULT_SETTINGS[k]))
      : keys.some((k) => !GLOBAL_ONLY.has(k) && override[shortKey(k)] !== undefined);
  const reset = (keys: FormatSettingKey[]): void => {
    if (scope === null) {
      for (const k of keys) void store.reset(k);
      return;
    }
    let next: ColumnFormat = override;
    for (const k of keys) next = withoutKey(next, shortKey(k)) as ColumnFormat;
    const all = global['format.connections'];
    void store.update(
      'format.connections',
      Object.keys(next).length > 0 ? { ...all, [scope]: next } : withoutKey(all, scope),
    );
  };

  const preview = (samples: [CellValue, LogicalType][]): React.ReactNode => (
    <span className="pref-preview" data-testid="pref-preview">
      <span className="pref-preview-label">{t.preview}</span>
      {samples.map(([sample, type], i) => (
        <code key={i}>
          {typeof sample === 'boolean' && value('format.boolean') === 'checkbox'
            ? sample
              ? '☑'
              : '☐'
            : formatCell(sample, type, effective)}
        </code>
      ))}
    </span>
  );
  const field = (label: string, control: React.ReactNode): React.ReactNode => (
    <label className="pref-field">
      <span>{label}</span>
      {control}
    </label>
  );
  const pattern = (key: 'format.date' | 'format.time' | 'format.datetime', presets: readonly string[]) =>
    field(
      f.pattern,
      <CommitInput
        value={value(key)}
        suggestions={presets}
        ariaLabel={`${f.pattern} (${key})`}
        className="pref-pattern"
        onCommit={(text) => {
          if (!text.trim()) return false;
          set(key, text.trim());
        }}
      />,
    );

  const row = (
    id: string,
    title: string,
    keys: FormatSettingKey[],
    controls: React.ReactNode,
    samples: [CellValue, LogicalType][],
    description?: string,
  ): PrefEntry => {
    const globalOnly = scope !== null && keys.every((k) => GLOBAL_ONLY.has(k));
    return {
      id,
      title,
      description,
      keywords: `${t.preview} ${es.preferences.groups.formats}`,
      modified: isModified(keys),
      onReset: () => reset(keys),
      render: () => (
        <>
          {controls}
          {preview(samples)}
          {globalOnly && <span className="pref-note">{t.globalOnly}</span>}
          {scope !== null && isModified(keys) && <span className="pref-note">{t.overridden}</span>}
        </>
      ),
    };
  };

  const decimalMode = value('format.decimal.mode');
  return [
    {
      id: 'format-scope',
      title: t.scope,
      description: t.scopeDescription,
      render: () => (
        <Select
          aria-label={t.scope}
          value={scope ?? ''}
          data-testid="format-scope"
          onChange={(e) => setScope(e.target.value || null)}
          options={[
            { value: '', label: t.scopeGlobal },
            ...connections.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
      ),
    },
    row(
      'format-numbers',
      t.numbers,
      ['format.locale', 'format.number.decimalSeparator', 'format.number.thousandsSeparator'],
      <>
        {field(
          t.decimalSeparator,
          <Select
            value={value('format.number.decimalSeparator')}
            disabled={disabled('format.number.decimalSeparator')}
            onChange={(e) =>
              set(
                'format.number.decimalSeparator',
                e.target.value as Settings['format.number.decimalSeparator'],
              )
            }
            options={opts(['.', ',', 'locale'] as const, t.decimalSeparators)}
          />,
        )}
        {value('format.number.decimalSeparator') === 'locale' &&
          field(
            t.locale,
            <CommitInput
              value={value('format.locale')}
              ariaLabel={t.locale}
              disabled={disabled('format.locale')}
              className="pref-pattern"
              onCommit={(text) => {
                if (!isLocale(text)) return false;
                set('format.locale', text.trim());
              }}
            />,
          )}
        <Checkbox
          label={f.thousands}
          checked={value('format.number.thousandsSeparator')}
          onChange={(e) => set('format.number.thousandsSeparator', e.target.checked)}
        />
      </>,
      [
        ['1234567.891', 'decimal'],
        ['-42', 'integer'],
      ],
      t.numbersDescription,
    ),
    row(
      'format-decimal',
      t.decimal,
      ['format.decimal.mode', 'format.decimal.places'],
      <>
        {field(
          f.decimalMode,
          <Select
            value={decimalMode}
            onChange={(e) => set('format.decimal.mode', e.target.value as Settings['format.decimal.mode'])}
            options={opts(['asStored', 'fixed', 'trimZeros'] as const, f.decimalModes)}
          />,
        )}
        {decimalMode === 'fixed' &&
          field(
            f.decimalPlaces,
            <CommitInput
              type="number"
              min={0}
              max={30}
              value={value('format.decimal.places')}
              ariaLabel={f.decimalPlaces}
              className="pref-number"
              onCommit={(text) => {
                const n = intInRange(text, 0, 30);
                if (n === null) return false;
                set('format.decimal.places', n);
              }}
            />,
          )}
      </>,
      [
        ['999999999.00', 'decimal'],
        ['12.50', 'decimal'],
      ],
      t.decimalDescription,
    ),
    row(
      'format-float',
      t.float,
      ['format.float.maxDigits'],
      field(
        f.floatDigits,
        <CommitInput
          type="number"
          min={1}
          max={17}
          value={value('format.float.maxDigits')}
          ariaLabel={f.floatDigits}
          className="pref-number"
          onCommit={(text) => {
            const n = intInRange(text, 1, 17);
            if (n === null) return false;
            set('format.float.maxDigits', n);
          }}
        />,
      ),
      [[3.141592653589793, 'float']],
      t.floatDescription,
    ),
    row(
      'format-date',
      t.date,
      ['format.date'],
      pattern('format.date', DATE_PRESETS),
      [['2026-09-30', 'date']],
      t.patternHelp,
    ),
    row('format-time', t.time, ['format.time'], pattern('format.time', TIME_PRESETS), [
      ['08:42:52.658', 'time'],
    ]),
    row(
      'format-datetime',
      t.datetime,
      ['format.datetime', 'format.datetime.showMillis'],
      <>
        {pattern('format.datetime', DATETIME_PRESETS)}
        {field(
          f.millis,
          <Select
            value={value('format.datetime.showMillis')}
            onChange={(e) =>
              set('format.datetime.showMillis', e.target.value as Settings['format.datetime.showMillis'])
            }
            options={opts(['whenPresent', 'always', 'never'] as const, f.millisModes)}
          />,
        )}
      </>,
      [
        ['2026-09-30 08:42:52.658', 'datetime'],
        ['2026-09-30 08:42:52', 'datetime'],
      ],
      t.patternHelp,
    ),
    row(
      'format-datetimetz',
      t.datetimetz,
      ['format.datetimetz.display'],
      field(
        f.zone,
        <Select
          value={value('format.datetimetz.display')}
          onChange={(e) =>
            set('format.datetimetz.display', e.target.value as Settings['format.datetimetz.display'])
          }
          options={opts(['asStored', 'local', 'utc'] as const, f.zones)}
        />,
      ),
      [['2026-09-30 08:42:52.658-05', 'datetimetz']],
    ),
    row(
      'format-boolean',
      t.boolean,
      ['format.boolean'],
      field(
        f.boolean,
        <Select
          value={value('format.boolean')}
          onChange={(e) => set('format.boolean', e.target.value as Settings['format.boolean'])}
          options={opts(['checkbox', 'true/false', '1/0', 'sí/no'] as const, f.booleans)}
        />,
      ),
      [
        [true, 'boolean'],
        [false, 'boolean'],
      ],
    ),
    row(
      'format-null',
      t.null,
      ['format.null'],
      field(
        t.nullText,
        <CommitInput
          value={value('format.null')}
          ariaLabel={t.nullText}
          disabled={disabled('format.null')}
          className="pref-pattern"
          onCommit={(text) => set('format.null', text)}
        />,
      ),
      [[null, 'text']],
      t.nullDescription,
    ),
    row(
      'format-binary',
      t.binary,
      ['format.binary', 'format.binary.maxBytes'],
      <>
        {field(
          f.binary,
          <Select
            value={value('format.binary')}
            onChange={(e) => set('format.binary', e.target.value as Settings['format.binary'])}
            options={opts(['hex', 'base64', 'size'] as const, f.binaries)}
          />,
        )}
        {field(
          t.maxBytes,
          <CommitInput
            type="number"
            min={1}
            max={10_000}
            value={value('format.binary.maxBytes')}
            ariaLabel={t.maxBytes}
            disabled={disabled('format.binary.maxBytes')}
            className="pref-number"
            onCommit={(text) => {
              const n = intInRange(text, 1, 10_000);
              if (n === null) return false;
              set('format.binary.maxBytes', n);
            }}
          />,
        )}
      </>,
      [['0x89504E470D0A1A0A0000000D49484452', 'binary']],
    ),
    row(
      'format-text',
      t.text,
      ['format.text.maxLength'],
      field(
        t.maxLength,
        <CommitInput
          type="number"
          min={10}
          max={1_000_000}
          value={value('format.text.maxLength')}
          ariaLabel={t.maxLength}
          disabled={disabled('format.text.maxLength')}
          className="pref-number"
          onCommit={(text) => {
            const n = intInRange(text, 10, 1_000_000);
            if (n === null) return false;
            set('format.text.maxLength', n);
          }}
        />,
      ),
      [['Un texto largo que muestra cómo se recorta en la celda de la grilla.', 'text']],
      t.textDescription,
    ),
  ];
}

function isLocale(text: string): boolean {
  try {
    return Intl.NumberFormat.supportedLocalesOf([text.trim()]).length > 0;
  } catch {
    return false;
  }
}
