import type { SettingKey } from '@shared/settings';
import { es } from '../../i18n/es';

/**
 * Texto del valor al que vuelve un ajuste con "Restablecer" (p. ej. "13px",
 * "activado", "Punto y coma"), para el botón "(Restablecer a …)".
 */

const p = es.preferences;
const f = es.results.format;

export type ResetUnit = keyof typeof p.resetUnits;

/** Ajustes de lista: su valor se muestra con la etiqueta de la opción. */
const OPTION_LABELS: Partial<Record<SettingKey, Record<string, string>>> = {
  'sql.statementSeparator': p.editor.separators,
  'format.number.decimalSeparator': p.formats.decimalSeparators,
  'format.decimal.mode': f.decimalModes,
  'format.datetime.showMillis': f.millisModes,
  'format.datetimetz.display': f.zones,
  'format.boolean': f.booleans,
  'format.binary': f.binaries,
};

/** Ajustes numéricos y su unidad. */
const UNITS: Partial<Record<SettingKey, ResetUnit>> = {
  'results.fontSize': 'px',
  'results.maxRows': 'rows',
  'history.maxEntries': 'entries',
  'format.decimal.places': 'decimals',
  'format.float.maxDigits': 'digits',
  'format.binary.maxBytes': 'bytes',
  'format.text.maxLength': 'characters',
};

/** Describe un valor cualquiera: sí/no, número (con unidad), texto (vacío incluido). */
export function describeValue(value: unknown, unit?: ResetUnit): string {
  if (typeof value === 'boolean') return value ? p.resetValues.on : p.resetValues.off;
  if (typeof value === 'number') {
    const suffix = unit ? p.resetUnits[unit][value === 1 ? 0 : 1] : '';
    return `${value.toLocaleString('es')}${suffix}`;
  }
  if (value === '' || value === null || value === undefined) return p.resetValues.empty;
  return String(value);
}

/** Describe el valor de una clave de settings. */
export function describeSetting(key: SettingKey, value: unknown): string {
  const labels = OPTION_LABELS[key];
  if (labels && typeof value === 'string') return labels[value] ?? value;
  if (key === 'files.autoSaveDelay' && typeof value === 'number')
    return describeValue(value / 1000, 'seconds');
  return describeValue(value, UNITS[key]);
}
