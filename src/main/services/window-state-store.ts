import { readFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WindowState } from '../windows/window-bounds';
import { parseWindowState } from '../windows/window-bounds';
import { writeFileAtomic } from './fs-atomic';

/** Lee y guarda `window-state.json` (tamaño, posición y maximizada de la ventana principal). */
export class WindowStateStore {
  constructor(private readonly file: string) {}

  async load(): Promise<WindowState | null> {
    try {
      return parseWindowState(JSON.parse(await readFile(this.file, 'utf8')));
    } catch {
      // Archivo inexistente o JSON inválido: se abre con el tamaño por defecto.
      return null;
    }
  }

  save(state: WindowState): Promise<void> {
    return writeFileAtomic(this.file, JSON.stringify(state, null, 2));
  }

  /** Para el cierre, cuando el proceso puede terminar antes de que acabe una escritura asíncrona. */
  saveSync(state: WindowState): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(state, null, 2), 'utf8');
  }
}
