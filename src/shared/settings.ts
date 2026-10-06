import { z } from 'zod';

/**
 * Preferencias del usuario (`userData/settings.json`, claves planas como en
 * VS Code). Cada clave se valida por separado con su valor por defecto: una
 * clave inválida no hace perder las demás. Las claves `editor.*` se pasan tal
 * cual a Monaco (specs/05).
 *
 * La UI de Preferencias (specs/04 §15) edita las más comunes; el resto, en
 * settings.json con esquema y autocompletado.
 */

const Bool = z.boolean();

/**
 * Formato de una columna desde la grilla (specs/06 §Formato por columna): las
 * mismas claves que `format.*` sin el prefijo, más la alineación.
 */
export const ColumnFormatSchema = z
  .object({
    'decimal.mode': z.enum(['asStored', 'fixed', 'trimZeros']),
    'decimal.places': z.number().int().min(0).max(30),
    'number.thousandsSeparator': Bool,
    'float.maxDigits': z.number().int().min(1).max(17),
    date: z.string().min(1).max(50),
    time: z.string().min(1).max(50),
    datetime: z.string().min(1).max(80),
    'datetime.showMillis': z.enum(['always', 'never', 'whenPresent']),
    'datetimetz.display': z.enum(['asStored', 'local', 'utc']),
    boolean: z.enum(['checkbox', 'true/false', '1/0', 'sí/no']),
    binary: z.enum(['hex', 'base64', 'size']),
    json: z.enum(['compact', 'pretty']),
    align: z.enum(['left', 'right', 'center']),
  })
  .partial();
export type ColumnFormat = z.infer<typeof ColumnFormatSchema>;

export const SETTINGS_SCHEMA = {
  'workspace.path': z.string().min(1).max(4096).nullable(),
  'files.autoSave': Bool,
  'files.autoSaveDelay': z.number().int().min(1000).max(60_000),
  'scripts.deleteEmptyOnClose': Bool,
  /** Nombres que no se muestran en la vista Archivos (specs/07). */
  'files.exclude': z.array(z.string().min(1).max(255)).max(200),
  /** Pedir confirmación al mover archivos arrastrando en el árbol. */
  'files.confirmDragAndDrop': Bool,
  /** Seleccionar en el árbol el archivo de la pestaña activa. */
  'files.autoReveal': Bool,
  /** Qué separa las sentencias de un script: solo el punto y coma, o también una línea en blanco. */
  'sql.statementSeparator': z.enum(['semicolon', 'blankLine']),
  /** Guardar las consultas ejecutadas en el historial (specs/06, specs/08). */
  'history.enabled': Bool,
  'history.maxEntries': z.number().int().min(100).max(1_000_000),

  'results.maxRows': z.number().int().positive().max(10_000_000),
  'results.alternateRows': Bool,
  'results.fontSize': z.number().int().min(8).max(32),
  'results.copy.nullAs': z.string().max(50),

  'format.locale': z.string().min(2).max(35),
  'format.null': z.string().max(50),
  'format.number.thousandsSeparator': Bool,
  'format.number.decimalSeparator': z.enum(['.', ',', 'locale']),
  'format.decimal.mode': z.enum(['asStored', 'fixed', 'trimZeros']),
  'format.decimal.places': z.number().int().min(0).max(30),
  'format.float.maxDigits': z.number().int().min(1).max(17),
  'format.date': z.string().min(1).max(50),
  'format.time': z.string().min(1).max(50),
  'format.datetime': z.string().min(1).max(80),
  'format.datetime.showMillis': z.enum(['always', 'never', 'whenPresent']),
  'format.datetimetz.display': z.enum(['asStored', 'local', 'utc']),
  'format.boolean': z.enum(['checkbox', 'true/false', '1/0', 'sí/no']),
  'format.binary': z.enum(['hex', 'base64', 'size']),
  'format.binary.maxBytes': z.number().int().min(1).max(10_000),
  'format.json': z.enum(['compact', 'pretty']),
  'format.text.maxLength': z.number().int().min(10).max(1_000_000),
  /** Formatos recordados por columna: `conexión/base/esquema/tabla/columna` → formato. */
  'format.columns': z.record(z.string().max(4000), ColumnFormatSchema),
  /** Formato por conexión (specs/06, nivel 2): id de conexión → claves que cambian sobre el global. */
  'format.connections': z.record(z.string().max(64), ColumnFormatSchema),
} as const;

export type SettingKey = keyof typeof SETTINGS_SCHEMA;

export type Settings = { [K in SettingKey]: z.infer<(typeof SETTINGS_SCHEMA)[K]> } & {
  /** Opciones de Monaco (`editor.*`), sin validar: se pasan con `updateOptions`. */
  editor: Record<string, unknown>;
};

export const DEFAULT_SETTINGS: Settings = {
  'workspace.path': null,
  'files.autoSave': true,
  'files.autoSaveDelay': 5000,
  'scripts.deleteEmptyOnClose': true,
  'files.exclude': ['.git', 'node_modules', '.DS_Store', 'Thumbs.db'],
  'files.confirmDragAndDrop': true,
  'files.autoReveal': true,
  'sql.statementSeparator': 'semicolon',
  'history.enabled': true,
  'history.maxEntries': 5000,

  'results.maxRows': 500,
  'results.alternateRows': true,
  'results.fontSize': 12,
  'results.copy.nullAs': '',

  'format.locale': 'es-PE',
  'format.null': 'NULL',
  'format.number.thousandsSeparator': true,
  'format.number.decimalSeparator': '.',
  'format.decimal.mode': 'asStored',
  'format.decimal.places': 2,
  'format.float.maxDigits': 15,
  'format.date': 'yyyy-MM-dd',
  'format.time': 'HH:mm:ss',
  'format.datetime': 'yyyy-MM-dd HH:mm:ss',
  'format.datetime.showMillis': 'whenPresent',
  'format.datetimetz.display': 'asStored',
  'format.boolean': 'checkbox',
  'format.binary': 'hex',
  'format.binary.maxBytes': 64,
  'format.json': 'compact',
  'format.text.maxLength': 500,
  'format.columns': {},
  'format.connections': {},
  editor: {},
};

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS_SCHEMA, key);
}

/** Interpreta el contenido de settings.json conservando cada clave válida. */
export function parseSettings(raw: unknown): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS, editor: {} };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return settings;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.startsWith('editor.')) {
      settings.editor[key.slice('editor.'.length)] = value;
    } else if (isSettingKey(key)) {
      const parsed = SETTINGS_SCHEMA[key].safeParse(value);
      if (parsed.success) (settings as Record<string, unknown>)[key] = parsed.data;
    }
  }
  return settings;
}

/** Valida el valor de una clave antes de escribirla. */
export function validateSetting(key: string, value: unknown): boolean {
  if (key.startsWith('editor.')) return true;
  return isSettingKey(key) && SETTINGS_SCHEMA[key].safeParse(value).success;
}
