import { readFile } from 'node:fs/promises';
import type { UiState } from '@shared/ui-state';
import { DEFAULT_UI_STATE, parseUiState } from '@shared/ui-state';
import { writeFileAtomic } from './fs-atomic';

/**
 * Lee y guarda `ui-state.json`. Las escrituras se serializan para que nunca
 * se pisen entre sí, y siempre queda en disco la última versión pedida.
 */
export class UiStateStore {
  private current: UiState = DEFAULT_UI_STATE;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  get state(): UiState {
    return this.current;
  }

  async load(): Promise<UiState> {
    try {
      const text = await readFile(this.file, 'utf8');
      this.current = parseUiState(JSON.parse(text));
    } catch {
      // Archivo inexistente o JSON inválido: se usan los valores por defecto.
      this.current = DEFAULT_UI_STATE;
    }
    return this.current;
  }

  save(state: UiState): Promise<void> {
    this.current = state;
    const text = JSON.stringify(state, null, 2);
    this.writing = this.writing.catch(() => undefined).then(() => writeFileAtomic(this.file, text));
    return this.writing;
  }
}
