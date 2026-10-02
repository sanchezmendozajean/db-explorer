import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';

const DEBOUNCE_MS = 200;

/**
 * Observa archivos de configuración de `userData` (`settings.json`,
 * `keybindings.json`) para aplicar los cambios sin reiniciar, también los
 * hechos con otro editor. Se observa la carpeta: la escritura atómica
 * reemplaza el archivo y un watcher sobre el archivo se perdería.
 */
export class ConfigWatcher {
  private watcher: FSWatcher | null = null;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly dir: string,
    private readonly handlers: Record<string, () => void>,
  ) {}

  start(): void {
    try {
      this.watcher = watch(this.dir, (_event, filename) => {
        const name = filename?.toString().toLowerCase();
        const handler = name ? this.handlers[name] : undefined;
        if (!name || !handler) return;
        clearTimeout(this.timers.get(name));
        this.timers.set(name, setTimeout(handler, DEBOUNCE_MS));
      });
      this.watcher.on('error', () => this.stop());
    } catch {
      this.watcher = null;
    }
  }

  stop(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.watcher?.close();
    this.watcher = null;
  }
}
