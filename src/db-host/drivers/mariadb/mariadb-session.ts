import type { Connection, FieldPacket, ResultSetHeader } from 'mysql2';
import type { CellValue } from '@shared/query';
import { ROW_BATCH_SIZE } from '@shared/query';
import { quoteIdent } from '@shared/sql-quote';
import type { DbSession, StatementOutcome, StatementSink } from '../types';
import { DriverError } from '../types';
import { commandOf, isDml } from '../common';
import { toMariaDbError } from './errors';
import { createTypeCast, describeFields, toCell } from './mariadb-types';

interface Waiter {
  resolve: (truncated: boolean) => void;
  reject: (err: Error) => void;
}

/** Estado de la sentencia en curso (o del cursor abierto para "Cargar más"). */
interface Running {
  sql: string;
  sink: StatementSink;
  buffer: CellValue[][];
  /** Filas que faltan para el límite del resultado actual (`null` = sin límite). */
  remaining: number | null;
  /** Se llegó al límite: la próxima fila indica que el resultado quedó truncado. */
  peeking: boolean;
  lookahead: CellValue[] | null;
  /** Socket en pausa por el límite; las filas del bloque ya recibido esperan en `overflow`. */
  holding: boolean;
  overflow: CellValue[][];
  /** Filas entregadas en la llamada actual (ejecutar o "Cargar más"). */
  loaded: number;
  limit: number | null;
  results: number;
  affected: number | undefined;
  warnings: number;
  /** La consulta terminó en el servidor (fin o error). */
  ended: boolean;
  error: Error | null;
  discarding: boolean;
  waiter: Waiter | null;
  finished: Promise<void>;
}

/**
 * Sesión de editor de MariaDB/MySQL sobre una conexión `mysql2` dedicada. Las
 * filas se leen en flujo; al llegar al límite se pausa el socket y la consulta
 * queda como cursor. Cancelar usa `KILL QUERY` desde la conexión de metadatos.
 *
 * Al pausar el socket, las filas que ya venían en el bloque recibido se
 * siguen procesando: se guardan en `overflow` y se entregan primero en el
 * siguiente "Cargar más".
 */
export class MariaDbSession implements DbSession {
  private running: Running | null = null;
  private cancelling = false;
  private closed = false;
  private schema: string | undefined;

  constructor(
    private readonly connection: Connection,
    readonly database: string,
    private readonly killQuery: (threadId: number) => Promise<void>,
  ) {
    connection.on('error', () => {
      this.closed = true;
    });
    connection.on('end', () => {
      this.closed = true;
    });
  }

  /** En MariaDB base y esquema son lo mismo: elegir esquema es `USE`. */
  async setSchema(schema: string | undefined): Promise<void> {
    if (!schema || schema === this.schema) return;
    await this.simple(`USE ${quoteIdent('mariadb', schema)}`);
    this.schema = schema;
  }

  async execute(sql: string, maxRows: number | null, sink: StatementSink): Promise<StatementOutcome> {
    await this.closeCursor();
    if (this.closed) throw new DriverError('Se perdió la conexión con el servidor', 'disconnected');
    const command = commandOf(sql, 'mariadb');
    let complete!: () => void;
    const state: Running = {
      sql,
      sink,
      buffer: [],
      remaining: maxRows,
      peeking: false,
      lookahead: null,
      holding: false,
      overflow: [],
      loaded: 0,
      limit: maxRows,
      results: 0,
      affected: undefined,
      warnings: 0,
      ended: false,
      error: null,
      discarding: false,
      waiter: null,
      finished: new Promise<void>((resolve) => (complete = resolve)),
    };
    this.running = state;
    this.cancelling = false;
    const cast = createTypeCast();
    let truncated: boolean;
    try {
      truncated = await new Promise<boolean>((resolve, reject) => {
        state.waiter = { resolve, reject };
        const query = this.connection.query({ sql, rowsAsArray: true, typeCast: cast.typeCast });
        query.on('fields', (fields: FieldPacket[] | undefined) => {
          this.flush(state);
          if (!fields) return;
          cast.setFields(fields);
          state.results++;
          state.peeking = false;
          state.remaining = state.limit;
          if (!state.discarding) sink.columns(describeFields(fields));
        });
        query.on('result', (row: unknown) => {
          if (!Array.isArray(row)) {
            const header = row as ResultSetHeader;
            state.affected = (state.affected ?? 0) + Number(header.affectedRows ?? 0);
            state.warnings += Number(header.warningStatus ?? 0);
            return;
          }
          this.onRow(state, row.map(toCell));
        });
        query.on('error', (err: Error) => {
          this.finish(state, err);
          complete();
        });
        query.on('end', () => {
          this.finish(state);
          complete();
        });
      });
    } catch (err) {
      this.running = null;
      throw err;
    }
    if (!state.holding) this.running = null;
    // Con el cursor abierto la conexión está ocupada: los avisos solo vienen de respuestas OK (sin filas).
    if (state.warnings > 0 && !state.holding) await this.showWarnings(sink);
    const dml = state.results === 0 && isDml(command);
    return {
      command,
      rowCount: state.results > 0 ? state.loaded : dml ? (state.affected ?? 0) : 0,
      affected: dml ? (state.affected ?? 0) : undefined,
      truncated,
    };
  }

  async fetchMore(count: number | null, sink: StatementSink): Promise<{ loaded: number; hasMore: boolean }> {
    const state = this.running;
    if (!state?.holding) return { loaded: 0, hasMore: false };
    state.sink = sink;
    state.loaded = 0;
    state.limit = count;
    state.remaining = count;
    state.peeking = count === 0;
    state.holding = false;
    // Primero la fila de más y las que ya habían llegado; si alcanzan para el límite, el socket sigue en pausa.
    const pending = [state.lookahead!, ...state.overflow];
    state.lookahead = null;
    state.overflow = [];
    while (pending.length > 0) {
      const row = pending.shift()!;
      if (state.holding) state.overflow.push(row);
      else this.deliver(state, row);
    }
    let hasMore: boolean;
    if (state.holding) {
      this.flush(state);
      hasMore = true;
    } else if (state.ended) {
      this.flush(state);
      this.running = null;
      this.socket().resume();
      if (state.error) throw this.toError(state, state.error);
      hasMore = false;
    } else {
      try {
        hasMore = await new Promise<boolean>((resolve, reject) => {
          state.waiter = { resolve, reject };
          this.socket().resume();
        });
      } catch (err) {
        this.running = null;
        throw err;
      }
    }
    if (!state.holding) this.running = null;
    return { loaded: state.loaded, hasMore };
  }

  async closeCursor(): Promise<void> {
    const state = this.running;
    this.running = null;
    if (!state) return;
    if (state.ended) {
      // Todo llegó en el bloque recibido: solo falta reanudar el socket para la siguiente consulta.
      if (state.holding) this.socket().resume();
      return;
    }
    // Se descarta el resto: KILL QUERY corta el envío en el servidor y se drena lo que ya llegó.
    state.discarding = true;
    state.waiter = null;
    state.overflow = [];
    await this.killQuery(this.connection.threadId).catch(() => undefined);
    this.socket().resume();
    await state.finished;
  }

  async cancel(): Promise<void> {
    if (!this.running || this.running.ended) return;
    this.cancelling = true;
    await this.killQuery(this.connection.threadId);
  }

  async close(): Promise<void> {
    this.running = null;
    this.closed = true;
    await new Promise<void>((resolve) => {
      this.connection.end(() => resolve());
      setTimeout(() => {
        this.connection.destroy();
        resolve();
      }, 2000);
    });
  }

  private socket(): NodeJS.ReadableStream {
    return (this.connection as unknown as { stream: NodeJS.ReadableStream }).stream;
  }

  private onRow(state: Running, cells: CellValue[]): void {
    if (state.discarding) return;
    if (state.holding) state.overflow.push(cells);
    else this.deliver(state, cells);
  }

  private deliver(state: Running, cells: CellValue[]): void {
    if (state.peeking) {
      state.peeking = false;
      state.lookahead = cells;
      state.holding = true;
      this.flush(state);
      this.socket().pause();
      const waiter = state.waiter;
      state.waiter = null;
      waiter?.resolve(true);
      return;
    }
    state.buffer.push(cells);
    state.loaded++;
    if (state.buffer.length >= ROW_BATCH_SIZE) this.flush(state);
    if (state.remaining !== null && --state.remaining <= 0) {
      this.flush(state);
      state.peeking = true;
    }
  }

  private flush(state: Running): void {
    if (state.buffer.length === 0) return;
    const rows = state.buffer;
    state.buffer = [];
    if (!state.discarding) state.sink.rows(rows);
  }

  private finish(state: Running, err?: Error): void {
    if (state.ended) return;
    state.ended = true;
    state.error = err ?? null;
    if (!state.holding) this.flush(state);
    const waiter = state.waiter;
    state.waiter = null;
    if (!waiter) return;
    if (err) waiter.reject(this.toError(state, err));
    // `KILL QUERY` sobre `SLEEP()` no da error (devuelve 1): si se pidió cancelar, se informa como cancelada.
    else if (this.cancelling) waiter.reject(new DriverError('Consulta cancelada', 'cancelled'));
    else waiter.resolve(false);
  }

  private toError(state: Running, err: Error): DriverError {
    return this.cancelling
      ? new DriverError('Consulta cancelada', 'cancelled')
      : toMariaDbError(err, state.sql);
  }

  /** Avisos del servidor (división por cero, truncamientos…) como mensajes. */
  private async showWarnings(sink: StatementSink): Promise<void> {
    const rows = await new Promise<unknown[][]>((resolve) => {
      this.connection.query({ sql: 'SHOW WARNINGS', rowsAsArray: true }, (err, result) =>
        resolve(err ? [] : (result as unknown[][])),
      );
    });
    for (const [level, code, message] of rows) {
      sink.message(String(level) === 'Note' ? 'notice' : 'warning', `${String(message)} (${String(code)})`);
    }
  }

  private simple(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connection.query(sql, (err) => (err ? reject(toMariaDbError(err, sql)) : resolve()));
    });
  }
}
