import { Worker } from 'node:worker_threads';
import { ROW_BATCH_SIZE } from '@shared/query';
import type { CellValue, LogicalType } from '@shared/query';
import type { DbSession, StatementOutcome, StatementSink } from '../types';
import { DriverError } from '../types';
import { commandOf, isDml, paramValue, positionOfSnippet } from '../common';

/** Receptor vacío para las peticiones sin resultados. */
const NO_SINK: StatementSink = { columns: () => undefined, rows: () => undefined, message: () => undefined };
import { sqliteWorkerMain } from './sqlite-worker';
import type { SqliteWorkerData, SqliteWorkerMessage, SqliteWorkerRequest } from './sqlite-worker';

const WORKER_SOURCE = `(${sqliteWorkerMain.toString()})()`;

interface Pending {
  sink: StatementSink;
  resolve: (message: SqliteWorkerMessage) => void;
  reject: (err: Error) => void;
  sql: string;
}

/** Error de SQLite con la posición del fragmento citado (`near "x": syntax error`). */
function sqliteError(message: string, code: string | undefined, sql: string): DriverError {
  const near = /near "([^"]*)"/.exec(message)?.[1];
  return new DriverError(message, code, { position: positionOfSnippet(sql, near) });
}

/**
 * Sesión de editor de SQLite: un `worker_thread` con su propia conexión al
 * archivo. Cancelar termina el hilo (se pierde el estado de la sesión, p. ej.
 * una transacción abierta) y la siguiente ejecución abre uno nuevo.
 */
export class SqliteSession implements DbSession {
  readonly database = 'main';
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private pending: Pending | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private manual = false;

  constructor(
    private readonly data: Omit<SqliteWorkerData, 'batchSize'>,
    private readonly queryTimeoutSec: number,
  ) {}

  /** Abre el hilo y el archivo; falla con el mensaje de SQLite si no se puede abrir. */
  start(): Promise<void> {
    if (this.ready) return this.ready;
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { ...this.data, batchSize: ROW_BATCH_SIZE } satisfies SqliteWorkerData,
    });
    this.worker = worker;
    this.ready = new Promise<void>((resolve, reject) => {
      worker.once('message', (message: SqliteWorkerMessage) => {
        if (message.type === 'ready') resolve();
        else {
          reject(new DriverError(message.type === 'error' ? message.message : 'No se pudo abrir el archivo'));
          void worker.terminate();
        }
        worker.on('message', (m: SqliteWorkerMessage) => {
          if (this.worker === worker) this.onMessage(m);
        });
      });
      worker.once('error', (err) => reject(new DriverError(err.message)));
    });
    // Un hilo cancelado termina más tarde: sus eventos no deben afectar al hilo nuevo de la sesión.
    worker.on('error', (err) => {
      if (this.worker === worker) this.fail(new DriverError(err.message));
    });
    worker.on('exit', () => {
      if (this.worker !== worker) return;
      this.reset();
      this.fail(new DriverError('La sesión de SQLite terminó', 'cancelled'));
    });
    this.ready.catch(() => {
      if (this.worker === worker) this.reset();
    });
    return this.ready;
  }

  async setSchema(): Promise<void> {
    // SQLite no tiene esquemas por sesión (solo `main` y bases adjuntas).
  }

  async execute(sql: string, maxRows: number | null, sink: StatementSink): Promise<StatementOutcome> {
    const command = commandOf(sql, 'sqlite');
    const done = await this.request(
      { type: 'execute', sql, maxRows, dml: isDml(command), manual: this.manual },
      sink,
      sql,
    );
    if (done.type !== 'done') throw new DriverError('Respuesta inesperada de la sesión de SQLite');
    return { command, rowCount: done.rowCount, affected: done.affected, truncated: done.truncated };
  }

  async fetchMore(count: number | null, sink: StatementSink): Promise<{ loaded: number; hasMore: boolean }> {
    if (!this.worker) return { loaded: 0, hasMore: false };
    const done = await this.request({ type: 'fetch', count }, sink, '');
    if (done.type !== 'fetched') throw new DriverError('Respuesta inesperada de la sesión de SQLite');
    return { loaded: done.loaded, hasMore: done.hasMore };
  }

  async closeCursor(): Promise<void> {
    this.worker?.postMessage({ type: 'close-cursor' } satisfies SqliteWorkerRequest);
  }

  /**
   * Modo manual: el hilo abre una transacción antes de cada sentencia si no
   * hay una abierta. Cancelar termina el hilo y con él la transacción.
   */
  async setAutoCommit(on: boolean): Promise<void> {
    if (on === !this.manual) return;
    if (on) await this.commit();
    this.manual = !on;
  }

  commit(): Promise<void> {
    return this.endTransaction(true);
  }

  rollback(): Promise<void> {
    return this.endTransaction(false);
  }

  async run(sql: string, params: CellValue[] = [], types: LogicalType[] = []): Promise<number> {
    const values = params.map((v, i) => {
      const value = paramValue(v, types[i]);
      // `node:sqlite` no acepta booleanos.
      return typeof value === 'boolean' ? (value ? 1 : 0) : value;
    });
    const done = await this.request({ type: 'run', sql, params: values, manual: this.manual }, NO_SINK, sql);
    if (done.type !== 'ran') throw new DriverError('Respuesta inesperada de la sesión de SQLite');
    return done.changes;
  }

  private async endTransaction(commit: boolean): Promise<void> {
    // Sin hilo no hay transacción abierta (se perdió al cancelar).
    if (!this.worker) return;
    await this.request({ type: 'end-transaction', commit }, NO_SINK, commit ? 'COMMIT' : 'ROLLBACK');
  }

  cancel(): Promise<void> {
    return this.abort(new DriverError('Consulta cancelada', 'cancelled'));
  }

  async close(): Promise<void> {
    const worker = this.worker;
    this.reset();
    await worker?.terminate();
  }

  private async request(
    message: SqliteWorkerRequest,
    sink: StatementSink,
    sql: string,
  ): Promise<SqliteWorkerMessage> {
    await this.start();
    const worker = this.worker!;
    return new Promise((resolve, reject) => {
      this.pending = { sink, resolve, reject, sql };
      if (this.queryTimeoutSec > 0) {
        this.timer = setTimeout(() => {
          const seconds = this.queryTimeoutSec;
          void this.abort(
            new DriverError(`Se superó el tiempo límite de la consulta (${seconds} s)`, 'timeout'),
          );
        }, this.queryTimeoutSec * 1000);
      }
      worker.postMessage(message);
    });
  }

  private onMessage(message: SqliteWorkerMessage): void {
    const pending = this.pending;
    if (!pending) return;
    switch (message.type) {
      case 'columns':
        pending.sink.columns(message.columns);
        return;
      case 'rows':
        pending.sink.rows(message.rows);
        return;
      case 'error':
        this.settle();
        pending.reject(sqliteError(message.message, message.code, pending.sql));
        return;
      default:
        this.settle();
        pending.resolve(message);
    }
  }

  private settle(): void {
    clearTimeout(this.timer);
    this.pending = null;
  }

  private fail(err: Error): void {
    const pending = this.pending;
    this.settle();
    pending?.reject(err);
  }

  /**
   * Termina el hilo con la consulta en curso (cancelar o tiempo límite) sin
   * esperarlo: V8 lo detiene al volver de SQLite a JavaScript (entre filas).
   * Un paso nativo largo (p. ej. un `count(*)` enorme) sigue hasta terminar
   * ese paso, pero la sesión ya queda libre y la siguiente ejecución abre un
   * hilo nuevo (limitación documentada en NOTAS, M4).
   */
  private async abort(reason: DriverError): Promise<void> {
    if (!this.pending || !this.worker) return;
    const worker = this.worker;
    this.reset();
    this.fail(reason);
    void worker.terminate();
  }

  /** Olvida el hilo actual; la próxima ejecución abre uno nuevo. */
  private reset(): void {
    this.worker = null;
    this.ready = null;
  }
}
