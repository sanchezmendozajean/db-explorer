import type { DbHostMethod, DbHostMethods, DbHostRequest } from '@shared/db-host-protocol';
import type { QueryEvent } from '@shared/query';
import { isDbHostOutgoing } from '@shared/db-host-protocol';

/** Abstracción del canal hacia el db-host (permite probar sin Electron). */
export interface DbHostTransport {
  postMessage(message: DbHostRequest): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): void;
}

export class DbHostUnavailableError extends Error {
  constructor(message = 'El proceso de base de datos no está disponible') {
    super(message);
    this.name = 'DbHostUnavailableError';
  }
}

export class DbHostTimeoutError extends Error {
  constructor(method: string) {
    super(`El proceso de base de datos no respondió a tiempo (${method})`);
    this.name = 'DbHostTimeoutError';
  }
}

/** Error devuelto por el db-host (p. ej. error de la base de datos), con su código si lo tiene. */
export class DbHostRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'DbHostRequestError';
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

export interface DbHostClientOptions {
  /** Tiempo máximo de espera por petición. */
  timeoutMs?: number;
  /** Máximo de reinicios dentro de `restartWindowMs` antes de rendirse. */
  maxRestarts?: number;
  restartWindowMs?: number;
  /** Se invoca cada vez que el db-host se reinicia tras una caída. */
  onRestart?: (reason: string) => void;
  /** Eventos de ejecución (filas, mensajes) emitidos por el db-host. */
  onQueryEvent?: (event: QueryEvent) => void;
  now?: () => number;
}

/**
 * Cliente del db-host: correlaciona peticiones/respuestas y reinicia el
 * proceso si se cae inesperadamente.
 */
export class DbHostClient {
  private transport: DbHostTransport | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private disposed = false;
  private restarts: number[] = [];
  private readonly timeoutMs: number;
  private readonly maxRestarts: number;
  private readonly restartWindowMs: number;
  private readonly now: () => number;

  constructor(
    private readonly createTransport: () => DbHostTransport,
    private readonly options: DbHostClientOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRestarts = options.maxRestarts ?? 5;
    this.restartWindowMs = options.restartWindowMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.disposed || this.transport) return;
    const transport = this.createTransport();
    this.transport = transport;
    transport.onMessage((message) => this.handleMessage(message));
    transport.onExit((code) => this.handleExit(transport, code));
  }

  get isRunning(): boolean {
    return this.transport !== null;
  }

  /**
   * Envía una petición. `timeoutMs: null` la deja sin límite (ejecución de
   * consultas: su duración la controla el usuario con Cancelar).
   */
  request<M extends DbHostMethod>(
    method: M,
    params: DbHostMethods[M]['params'],
    options: { timeoutMs?: number | null } = {},
  ): Promise<DbHostMethods[M]['result']> {
    const transport = this.transport;
    if (!transport) return Promise.reject(new DbHostUnavailableError());
    const id = this.nextId++;
    const timeoutMs = options.timeoutMs === undefined ? this.timeoutMs : options.timeoutMs;
    return new Promise<DbHostMethods[M]['result']>((resolve, reject) => {
      const timer =
        timeoutMs === null
          ? undefined
          : setTimeout(() => {
              this.pending.delete(id);
              reject(new DbHostTimeoutError(method));
            }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      transport.postMessage({ kind: 'request', id, method, params });
    });
  }

  dispose(): void {
    this.disposed = true;
    this.rejectAll(new DbHostUnavailableError('La aplicación se está cerrando'));
    const transport = this.transport;
    this.transport = null;
    transport?.kill();
  }

  private handleMessage(message: unknown): void {
    if (!isDbHostOutgoing(message)) return;
    if (message.kind === 'query-event') {
      this.options.onQueryEvent?.(message.event);
      return;
    }
    if (message.kind !== 'response') return;
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new DbHostRequestError(message.error.message, message.error.code));
  }

  private handleExit(transport: DbHostTransport, code: number): void {
    if (this.transport !== transport) return;
    this.transport = null;
    this.rejectAll(new DbHostUnavailableError());
    if (this.disposed) return;

    const now = this.now();
    this.restarts = this.restarts.filter((t) => now - t < this.restartWindowMs);
    if (this.restarts.length >= this.maxRestarts) return;
    this.restarts.push(now);

    this.start();
    this.options.onRestart?.(`código de salida ${code}`);
  }

  private rejectAll(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
}
