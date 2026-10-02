import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'jsonc-parser';
import type { UserKeybindings } from '@shared/keybindings';
import { UserKeybindingSchema } from '@shared/keybindings';

/** Plantilla de `keybindings.json` al abrirlo por primera vez. */
export const KEYBINDINGS_TEMPLATE = `// Atajos personalizados de DB Explorer (mismo formato que VS Code).
// Cada entrada: { "key": "ctrl+e", "command": "db.executeStatement", "when": "editorTextFocus" }
// Un comando con "-" delante quita su atajo: { "key": "ctrl+enter", "command": "-db.executeStatement" }
// Los cambios se aplican al guardar, sin reiniciar.
[
]
`;

/** Plantilla de `settings.json` al abrirlo por primera vez. */
export const SETTINGS_TEMPLATE = `// Preferencias de DB Explorer (JSON con comentarios, como VS Code).
// Escribe una clave entre comillas para ver las disponibles. Se aplican al guardar.
{
}
`;

/**
 * `keybindings.json` en `userData` (specs/05 §Personalización): JSON con
 * comentarios; las entradas no válidas se omiten y se informan.
 */
export class KeybindingsStore {
  private current: UserKeybindings = { rules: [], invalid: 0 };

  constructor(private readonly file: string) {}

  get keybindings(): UserKeybindings {
    return this.current;
  }

  async load(): Promise<UserKeybindings> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch {
      this.current = { rules: [], invalid: 0 };
      return this.current;
    }
    const raw: unknown = parse(text, [], { allowTrailingComma: true });
    if (!Array.isArray(raw)) {
      this.current = { rules: [], invalid: text.trim() ? 1 : 0 };
      return this.current;
    }
    const rules = raw.flatMap((entry) => {
      const parsed = UserKeybindingSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
    this.current = { rules, invalid: raw.length - rules.length };
    return this.current;
  }
}

/** Crea el archivo con la plantilla si todavía no existe. */
export async function ensureFile(path: string, template: string): Promise<void> {
  if (!existsSync(path)) await writeFile(path, template, { flag: 'wx' }).catch(() => undefined);
}
