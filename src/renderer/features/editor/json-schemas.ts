import { z } from 'zod';
import { SETTINGS_SCHEMA } from '@shared/settings';
import { commands } from '../../commands/service';
import { DEFAULT_KEYBINDINGS } from '../../commands/default-keybindings';
import { commandTitle } from '../../i18n/es';
import { jsonDefaultsIfLoaded, loadMonaco } from './monaco/loader';

/**
 * Esquemas JSON de `settings.json` y `keybindings.json` (specs/09 M6:
 * autocompletado de claves y comandos, avisos de valores no válidos).
 */

/** Rutas de los archivos de configuración ya abiertos (el esquema se asocia a su URI). */
const paths: Partial<Record<'settings' | 'keybindings', string>> = {};

function settingsSchema(): object {
  const properties: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(SETTINGS_SCHEMA)) {
    const json = z.toJSONSchema(schema) as Record<string, unknown>;
    delete json['$schema'];
    properties[key] = json;
  }
  return {
    type: 'object',
    properties,
    // Opciones de Monaco (`editor.*`) se pasan tal cual; otras claves se marcan como desconocidas.
    patternProperties: { '^editor\\.': {} },
    additionalProperties: false,
  };
}

function keybindingsSchema(): object {
  const ids = [
    ...new Set([...commands.all().map((c) => c.id), ...DEFAULT_KEYBINDINGS.map((r) => r.command)]),
  ].sort();
  return {
    type: 'array',
    items: {
      type: 'object',
      required: ['key', 'command'],
      additionalProperties: false,
      properties: {
        key: { type: 'string', description: 'Atajo, p. ej. "ctrl+e" o el acorde "ctrl+k s".' },
        command: {
          anyOf: [
            { enum: ids, markdownEnumDescriptions: ids.map((id) => commandTitle(id)) },
            { type: 'string', pattern: '^-', description: 'Con "-" delante quita el atajo de ese comando.' },
          ],
        },
        when: {
          type: 'string',
          description:
            'Contexto: editorTextFocus, resultsFocus, treeFocus, filesFocus, isProduction (con !, && y ||).',
        },
      },
    },
  };
}

/**
 * Patrón del archivo para el servicio de JSON: carpeta y nombre (glob). La URI
 * completa no sirve como patrón (lleva caracteres codificados, como `c%3A`).
 */
function fileMatch(path: string): string[] {
  const parts = path.split(/[\\/]/);
  return [`**/${parts.slice(-2).join('/')}`];
}

/** Asocia el esquema al archivo abierto. */
export function registerConfigSchema(file: 'settings' | 'keybindings', path: string): void {
  paths[file] = path;
  void loadMonaco().then(() => {
    const json = jsonDefaultsIfLoaded();
    if (!json) return;
    const schemas = [];
    if (paths.settings) {
      schemas.push({
        uri: 'dbx://schemas/settings.json',
        fileMatch: fileMatch(paths.settings),
        schema: settingsSchema(),
      });
    }
    if (paths.keybindings) {
      schemas.push({
        uri: 'dbx://schemas/keybindings.json',
        fileMatch: fileMatch(paths.keybindings),
        schema: keybindingsSchema(),
      });
    }
    json.setDiagnosticsOptions({
      validate: true,
      allowComments: true,
      trailingCommas: 'ignore',
      schemas,
      enableSchemaRequest: false,
    });
  });
}
