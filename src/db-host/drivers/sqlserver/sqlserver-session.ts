import type { Connection } from 'tedious';
import { Request, TYPES } from 'tedious';
import type { ColumnMetadata } from 'tedious/lib/token/colmetadata-token-parser';
import type { CellValue, LogicalType, ResultColumn } from '@shared/query';
import { ROW_BATCH_SIZE } from '@shared/query';
import type { DbSession, StatementOutcome, StatementSink } from '../types';
import { DriverError } from '../types';
import { commandOf, isDml, paramValue } from '../common';
import { toSqlServerError } from './errors';
import { logicalTypeOf, nativeTypeOf, toCell } from './sqlserver-types';

/** Descripción de una columna de resultado obtenida de `sys.dm_exec_describe_first_result_set`. */
export interface DescribedColumn {
  nativeType: string;
  sourceSchema?: string;
  sourceTable?: string;
  sourceColumn?: string;
  isPk?: boolean;
}

/** Describe el primer resultado de una sentencia (tipo exacto, tabla de origen y clave). */
export type ResultDescriber = (sql: string) => Promise<(DescribedColumn | undefined)[] | null>;

interface Waiter {
  resolve: (truncated: boolean) => void;
  reject: (err: Error) => void;
}

/** Estado de la sentencia en curso (o del cursor abierto para "Cargar más"). */
interface Running {
  request: Request;
  sql: string;
  sink: StatementSink;
  buffer: CellValue[][];
  /** Filas que faltan para pausar en el resultado actual (`null` = sin límite). */
  remaining: number | null;
  /** Se leyó hasta el límite: la próxima fila indica que el resultado quedó truncado. */
  peeking: boolean;
  lookahead: CellValue[] | null;
  /** Filas entregadas en la llamada actual (ejecutar o "Cargar más"). */
  loaded: number;
  limit: number | null;
  inResult: boolean;
  results: number;
  affected: number | undefined;
  completed: boolean;
  /** Al cerrar el cursor se descartan las filas restantes. */
  discarding: boolean;
  waiter: Waiter | null;
  finished: Promise<void>;
}

/**
 * Sesión de editor de SQL Server sobre una conexión `tedious` dedicada. Cada
 * sentencia se envía como lote (`execSqlBatch`) para que las tablas `#temp`
 * y las variables de sesión se conserven. Los resultados se leen en lotes y,
 * al llegar al límite, la petición queda en pausa como cursor.
 */
export class SqlServerSession implements DbSession {
  private running: Running | null = null;
  private cancelling = false;
  private closed = false;
  private manual = false;

  constructor(
    private readonly connection: Connection,
    readonly database: string,
    private readonly describe: ResultDescriber,
  ) {
    connection.on('infoMessage', (info) => {
      // 5701/5703: cambio de base o idioma (ruido de USE y del inicio de sesión).
      if (info.number === 5701 || info.number === 5703) return;
      this.running?.sink.message(info.class > 10 ? 'warning' : 'notice', info.message);
    });
    connection.on('end', () => {
      this.closed = true;
      this.running?.waiter?.reject(new DriverError('Se perdió la conexión con el servidor', 'disconnected'));
    });
    connection.on('error', () => undefined);
  }

  async setSchema(): Promise<void> {
    // En SQL Server el esquema por defecto es del usuario, no de la sesión: los nombres sin calificar lo usan.
  }

  async execute(sql: string, maxRows: number | null, sink: StatementSink): Promise<StatementOutcome> {
    await this.closeCursor();
    if (this.closed) throw new DriverError('Se perdió la conexión con el servidor', 'disconnected');
    await this.beginIfManual();
    const command = commandOf(sql, 'sqlserver');
    let complete!: () => void;
    const state: Running = {
      request: new Request(sql, (err) => this.onComplete(state, err ?? undefined)),
      sql,
      sink,
      buffer: [],
      remaining: maxRows,
      peeking: false,
      lookahead: null,
      loaded: 0,
      limit: maxRows,
      inResult: false,
      results: 0,
      affected: undefined,
      completed: false,
      discarding: false,
      waiter: null,
      finished: new Promise<void>((resolve) => (complete = resolve)),
    };
    state.request.on('requestCompleted', () => complete());
    this.attach(state);
    this.running = state;
    this.cancelling = false;
    let truncated: boolean;
    try {
      truncated = await new Promise<boolean>((resolve, reject) => {
        state.waiter = { resolve, reject };
        this.connection.execSqlBatch(state.request);
      });
    } finally {
      if (state.completed) this.running = null;
    }
    const dml = state.results === 0 && state.affected !== undefined && isDml(command);
    return {
      command,
      rowCount: state.results > 0 ? state.loaded : dml ? state.affected! : 0,
      affected: dml ? state.affected : undefined,
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
        state.request.resume();
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
    state.discarding = true;
    state.waiter = null;
    this.connection.cancel();
    state.request.resume();
    await state.finished;
  }

  async cancel(): Promise<void> {
    if (!this.running || this.running.completed) return;
    this.cancelling = true;
    this.connection.cancel();
  }

  async close(): Promise<void> {
    this.running = null;
    this.closed = true;
    await new Promise<void>((resolve) => {
      this.connection.once('end', () => resolve());
      this.connection.close();
      setTimeout(resolve, 2000);
    });
  }

  /**
   * Modo manual: antes de cada sentencia se abre una transacción explícita si
   * no hay una (`@@TRANCOUNT = 0`). No se usa `IMPLICIT_TRANSACTIONS`, que
   * anida un `BEGIN TRANSACTION` del usuario dentro de la implícita.
   */
  async setAutoCommit(on: boolean): Promise<void> {
    if (on === !this.manual) return;
    if (on) await this.commit();
    this.manual = !on;
  }

  async commit(): Promise<void> {
    await this.closeCursor();
    await this.batch('IF @@TRANCOUNT > 0 COMMIT TRANSACTION');
  }

  async rollback(): Promise<void> {
    await this.closeCursor();
    await this.batch('IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION');
  }

  async run(sql: string, params: CellValue[] = [], types: LogicalType[] = []): Promise<number> {
    await this.closeCursor();
    await this.beginIfManual();
    // Sin parámetros, como lote: un `BEGIN TRANSACTION` dentro de `sp_executesql` no sobrevive al cerrar el procedimiento.
    if (params.length === 0) return this.batch(sql);
    return new Promise<number>((resolve, reject) => {
      const request = new Request(sql, (err, rowCount) =>
        err ? reject(toSqlServerError(err, sql)) : resolve(rowCount ?? 0),
      );
      params.forEach((v, i) => {
        const value = paramValue(v, types[i]);
        const type = Buffer.isBuffer(value)
          ? TYPES.VarBinary
          : typeof value === 'boolean'
            ? TYPES.Bit
            : typeof value === 'number'
              ? Number.isInteger(value)
                ? TYPES.BigInt
                : TYPES.Float
              : TYPES.NVarChar;
        request.addParameter(`p${i + 1}`, type, value);
      });
      this.connection.execSql(request);
    });
  }

  private async beginIfManual(): Promise<void> {
    if (this.manual) await this.batch('IF @@TRANCOUNT = 0 BEGIN TRANSACTION');
  }

  /** Lote sin resultados (control de transacciones); devuelve las filas afectadas. */
  private batch(sql: string): Promise<number> {
    if (this.closed)
      return Promise.reject(new DriverError('Se perdió la conexión con el servidor', 'disconnected'));
    return new Promise<number>((resolve, reject) => {
      const request = new Request(sql, (err, rowCount) =>
        err ? reject(toSqlServerError(err, sql)) : resolve(rowCount ?? 0),
      );
      this.connection.execSqlBatch(request);
    });
  }

  private attach(state: Running): void {
    const { request } = state;
    request.on('columnMetadata', (columns) => {
      this.flush(state);
      state.inResult = true;
      state.peeking = false;
      state.remaining = state.limit;
      const metas = (Array.isArray(columns) ? columns : Object.values(columns)) as ColumnMetadata[];
      const first = state.results === 0;
      state.results++;
      if (state.discarding) return;
      if (!first) {
        state.sink.columns(metas.map((m) => this.column(m)));
        return;
      }
      // El primer resultado se describe en la conexión de metadatos; mientras tanto no llegan filas.
      request.pause();
      void this.describe(state.sql)
        .catch(() => null)
        .then((described) => {
          state.sink.columns(
            metas.map((m, i) => {
              const d = described && described.length === metas.length ? described[i] : undefined;
              return this.column(m, d);
            }),
          );
          if (!state.completed && !state.lookahead) request.resume();
        });
    });
    request.on('row', (columns: { value: unknown }[]) => {
      if (state.discarding) return;
      const cells = columns.map((c) => toCell(c.value));
      if (state.peeking) {
        state.peeking = false;
        state.lookahead = cells;
        request.pause();
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
    });
    const onDone = (rowCount: number | undefined): void => {
      this.flush(state);
      if (state.inResult) {
        state.inResult = false;
        state.peeking = false;
      } else if (rowCount !== undefined) {
        state.affected = (state.affected ?? 0) + rowCount;
      }
    };
    request.on('done', onDone);
    request.on('doneInProc', onDone);
  }

  private column(meta: ColumnMetadata, described?: DescribedColumn): ResultColumn {
    return {
      name: meta.colName,
      nativeType: described?.nativeType || nativeTypeOf(meta),
      logicalType: logicalTypeOf(meta),
      sourceSchema: described?.sourceSchema,
      sourceTable: described?.sourceTable,
      sourceColumn: described?.sourceColumn,
      isPk: described?.isPk,
    };
  }

  private flush(state: Running): void {
    if (state.buffer.length === 0) return;
    const rows = state.buffer;
    state.buffer = [];
    if (!state.discarding) state.sink.rows(rows);
  }

  private onComplete(state: Running, err: Error | undefined): void {
    state.completed = true;
    this.flush(state);
    const waiter = state.waiter;
    state.waiter = null;
    if (!waiter) return;
    if (err) {
      waiter.reject(
        this.cancelling
          ? new DriverError('Consulta cancelada', 'cancelled')
          : toSqlServerError(err, state.sql),
      );
    } else {
      waiter.resolve(false);
    }
  }
}
