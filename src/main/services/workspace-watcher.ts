import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { basename, join } from 'node:path';

/** Espera para agrupar ráfagas de cambios (specs/07: debounce de 200 ms). */
const DEBOUNCE_MS = 200;

/**
 * Observa el espacio de trabajo (`fs.watch` recursivo, nativo en Windows) y
 * avisa las rutas cambiadas en lotes. Las rutas excluidas (`.git`,
 * temporales de la escritura atómica…) se ignoran.
 */
export class WorkspaceWatcher {
  private watcher: FSWatcher | null = null;
  private pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly onChange: (paths: string[]) => void,
    private readonly isExcluded: (name: string) => boolean,
  ) {}

  start(root: string): void {
    this.stop();
    try {
      this.watcher = watch(root, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const relative = filename.toString();
        if (relative.split(/[\\/]/).some((part) => this.isExcluded(part))) return;
        this.pending.add(join(root, relative));
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), DEBOUNCE_MS);
      });
      // Carpeta borrada o unidad desconectada: se deja de observar sin tumbar la app.
      this.watcher.on('error', () => this.stop());
    } catch {
      this.watcher = null;
    }
  }

  stop(): void {
    clearTimeout(this.timer);
    this.pending.clear();
    this.watcher?.close();
    this.watcher = null;
  }

  private flush(): void {
    const paths = [...this.pending].filter((p) => !this.isExcluded(basename(p)));
    this.pending.clear();
    if (paths.length > 0) this.onChange(paths);
  }
}
