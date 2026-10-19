import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '@shared/updates';

interface Options {
  /** Falso en desarrollo, en pruebas y en la versión portable: no hay instalador que actualizar. */
  supported: boolean;
  onStatus: (status: UpdateStatus) => void;
  /** Pruebas de interfaz: simula el resultado de la búsqueda sin red ni instalador. */
  fake?: 'ready' | 'none' | 'error';
}

/**
 * Actualización desde GitHub Releases (`publish` de electron-builder.yml) con electron-updater.
 * La descarga arranca sola al encontrar una versión nueva; el reinicio lo decide el usuario.
 * Es la única llamada de red de la app que no es una conexión a una base de datos.
 */
export class UpdateService {
  status: UpdateStatus;
  private current: Promise<UpdateStatus> | null = null;

  constructor(private readonly options: Options) {
    this.status = options.supported || options.fake ? { state: 'idle' } : { state: 'unsupported' };
    if (!options.supported || options.fake) return;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', (info) =>
      this.set({ state: 'downloading', version: info.version, percent: 0 }),
    );
    autoUpdater.on('download-progress', (p) => {
      if (this.status.state === 'downloading') {
        this.set({ ...this.status, percent: Math.round(p.percent) });
      }
    });
    autoUpdater.on('update-downloaded', (info) => this.set({ state: 'ready', version: info.version }));
    autoUpdater.on('update-not-available', () => this.set({ state: 'none' }));
    autoUpdater.on('error', (err) => this.set({ state: 'error', message: err.message }));
  }

  private set(status: UpdateStatus): void {
    this.status = status;
    this.options.onStatus(status);
  }

  /** Busca (y descarga) una versión nueva. Con una ya encontrada o en curso no repite la búsqueda. */
  check(): Promise<UpdateStatus> {
    if (this.options.fake) return this.checkFake(this.options.fake);
    if (!this.options.supported) return Promise.resolve(this.status);
    if (this.status.state === 'ready' || this.status.state === 'downloading') {
      return Promise.resolve(this.status);
    }
    if (this.current) return this.current;
    this.set({ state: 'checking' });
    this.current = autoUpdater
      .checkForUpdates()
      .then(() => this.status)
      .catch((err: unknown) => {
        // `error` ya se emitió por el evento; si no, se informa aquí.
        if (this.status.state !== 'error') {
          this.set({ state: 'error', message: err instanceof Error ? err.message : String(err) });
        }
        return this.status;
      })
      .finally(() => {
        this.current = null;
      });
    return this.current;
  }

  /** Recorre los mismos estados que la descarga real, con pausas cortas para verlos. */
  private checkFake(outcome: 'ready' | 'none' | 'error'): Promise<UpdateStatus> {
    if (this.status.state === 'ready' || this.status.state === 'downloading') {
      return Promise.resolve(this.status);
    }
    this.set({ state: 'checking' });
    const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    return pause(800).then(async () => {
      if (outcome === 'none') this.set({ state: 'none' });
      else if (outcome === 'error') this.set({ state: 'error', message: 'Simulación de error de red' });
      else {
        this.set({ state: 'downloading', version: '9.9.9', percent: 0 });
        void pause(2500).then(() => this.set({ state: 'ready', version: '9.9.9' }));
      }
      return this.status;
    });
  }

  install(): void {
    if (this.options.fake) return;
    if (this.status.state === 'ready') autoUpdater.quitAndInstall(true, true);
  }
}
