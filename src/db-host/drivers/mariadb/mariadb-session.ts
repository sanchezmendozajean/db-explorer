import type { Connection, FieldPacket, ResultSetHeader } from 'mysql2';
import type { CellValue } from '@shared/query';
import { ROW_BATCH_SIZE } from '@shared/query';
import { quoteIdent } from '@shared/sql-quote';
import type { DbSession, StatementOutcome, StatementSink } from '../types';
import { DriverError } from '../types';
import { commandOf, isDml } from '../common';
import { toMariaDbError } from './errors';
import { describeFields, toCell, typeCast } from './mariadb-types';

interface Waiter {
  resolve: (truncated: boolean) => void;
  reject: (err: Error) => void;
}

/** Estado de la sentencia en curso (o del cursor abierto para "Cargar más"). */
interface Running {
  sql: string;
  sink: StatementSink;
  buffer: CellValue[][];
  remaining: number | null;
  peeking: boolean;
  lookahead: CellValue[] | null;
  loaded: number;
  limit: number | null;
  results: number;
  affected: number | undefined;
  warnings: number;
  completed: boolean;
  discarding: boolean;
  waiter: Waiter | null;
  finished: Promise<void>;
}

/**
 * Sesión de editor de MariaDB/MySQL sobre una conexión `mysql2` dedicada. Las
 * filas se leen en flujo; al llegar al límite se pausa el socket y la consulta
 * queda como cursor. Cancelar usa `KILL QUERY` desde la conexión de metadatos.
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
      loaded: 0,
      limit: maxRows,
      results: 0,
      affected: undefined,
      warnings: 0,
      completed: false,
      discarding: false,
      waiter: null,
      finished: new Promise<void>((resolve) => (complete = resolve)),
    };
    this.running = state;
    this.cancelling = false;
    let truncated: boolean;
    try {
      truncated = await new Promise<boolean>((resolve, reject) => {
        state.waiter = { resolve, reject };
        const query = this.connection.query({ sql, rowsAsArray: true, typeCast });
        query.on('fields', (fields: FieldPacket[] | undefined) => {
          this.flush(state);
          if (!fields) return;
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
        query.on('error', (err: Error) => this.finish(state, err));
        query.on('end', () => {
          this.finish(state);
          complete();
        });
      });
    } finally {
      if (state.completed) this.running = null;
    }
    if (state.warnings > 0) await this.showWarnings(sink);
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
    if (!state || state.completed) return { loaded: 0, hasMore: false };
    state.sink = sink;
    state.loaded = 0;
    state.limit = count;
    if (state.lookahead) {
      sink.rows([state.lookahead]);
      state.lookahead = null;
      state.loaded = 1;
    }
    state.remaining = count === null ? null : count - state.loaded;
    state.peeking = state.remaining === 0;
    let hasMore: boolean;
    try {
      hasMore = await new Promise<boolean>((resolve, reject) => {
        state.waiter = { resolve, reject };
        this.connection.resume();
      });
    } finally {
      if (state.completed) this.running = null;
    }
    return { loaded: state.loaded, hasMore };
  }

  async closeCursor(): Promise<void> {
    const state = this.running;
    this.running = null;
    if (!state || state.completed) return;
    // Se descarta el resto: KILL QUERY corta el envío en el servidor y se drena lo que ya llegó.
    state.discarding = true;
    state.waiter = null;
    await this.killQuery(this.connection.threadId).catch(() => undefined);
    this.connection.resume();
    await state.finished;
  }

  async cancel(): Promise<void> {
    if (!this.running || this.running.completed) return;
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

  private onRow(state: Running, cells: CellValue[]): void {
    if (state.discarding) return;
    if (state.peeking) {
      state.peeking = false;
      state.lookahead = cells;
      this.connection.pause();
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
    if (state.completed) return;
    state.completed = true;
    this.flush(state);
    const waiter = state.waiter;
    state.waiter = null;
    if (!waiter) return;
    if (err) {
      waiter.reject(this.cancelling ? new DriverError('Consulta cancelada', 'cancelled') : toMariaDbError(err, state.sql));
    } else {
      waiter.resolve(false);
    }
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
