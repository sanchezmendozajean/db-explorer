import { readFile } from 'node:fs/promises';
import { applyEdits, modify, parse } from 'jsonc-parser';
import type { ParseError } from 'jsonc-parser';
import type { Settings } from '@shared/settings';
import { DEFAULT_SETTINGS, parseSettings } from '@shared/settings';
import { writeFileAtomic } from './fs-atomic';

/**
 * `settings.json` (JSON con comentarios, como VS Code). Las escrituras
 * modifican solo la clave cambiada y conservan comentarios y formato.
 */
export class SettingsStore {
  private current: Settings = DEFAULT_SETTINGS;
  private text = '{}';
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  get settings(): Settings {
    return this.current;
  }

  async load(): Promise<Settings> {
    try {
      this.text = await readFile(this.file, 'utf8');
    } catch {
      this.text = '{}';
    }
    const errors: ParseError[] = [];
    const raw: unknown = parse(this.text, errors, { allowTrailingComma: true });
    this.current = parseSettings(raw);
    return this.current;
  }

  /** Cambia una clave (`undefined` la quita) y guarda de forma atómica. */
  update(key: string, value: unknown): Promise<Settings> {
    const edits = modify(this.text, [key], value, {
      formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
    });
    this.text = applyEdits(this.text, edits);
    this.current = parseSettings(parse(this.text, [], { allowTrailingComma: true }));
    const text = this.text;
    this.writing = this.writing.catch(() => undefined).then(() => writeFileAtomic(this.file, text));
    return this.writing.then(() => this.current);
  }
}
