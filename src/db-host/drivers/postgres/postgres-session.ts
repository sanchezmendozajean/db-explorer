import type pg from 'pg';
import type { FieldDef } from 'pg';
import Cursor from 'pg-cursor';
import type { CellValue, LogicalType, ResultColumn } from '@shared/query';
import { ROW_BATCH_SIZE } from '@shared/query';
import { quoteIdent } from '@shared/sql-quote';
import type { DbSession, StatementOutcome, StatementSink } from '../types';
import { DriverError } from '../types';
import { paramValue } from '../common';
import { toDriverError } from './errors';

/** Booleanos y enteros de 32 bits como valores JS; todo lo demás como texto crudo del servidor. */
const NUMBER_OIDS = new Set([21, 23, 26]); // int2, int4, oid
const BOOL_OID = 16;

const identity = (value: string): string => value;
const toBool = (value: string): boolean => value === 't';

export const sessionTypes: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number) => {
    if (oid === BOOL_OID) return toBool;
    if (NUMBER_OIDS.has(oid)) return Number;
    return identity;
  }) as pg.CustomTypesConfig['getTypeParser'],
};

/** Describe las columnas de un resultado (tipo nativo, tabla de origen, PK). */
export type FieldDescriber = (fields: FieldDef[]) => Promise<ResultColumn[]>;

interface OpenCursor {
  cursor: Cursor<CellValue[]>;
  /** Fila leída de más para saber si quedaban filas. */
  lookahead: CellValue[] | null;
}

function readBatch(
  cursor: Cursor<CellValue[]>,
  count: number,
): Promise<{ rows: CellValue[][]; result: pg.QueryResult }> {
  return new Promise((resolve, reject) => {
    cursor.read(count, (err, rows, result) => {
      if (err) reject(err);
      else resolve({ rows, result });
    });
  });
}

const DML = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'COPY']);

export class PostgresSession implements DbSession {
  private open: OpenCursor | null = null;
  private currentSink: StatementSink | null = null;
  private schema: string | undefined;
  /** Modo de transacción manual (specs/04 §8). */
  private manual = false;

  constructor(
    private readonly client: pg.Client,
    readonly database: string,
    private readonly describe: FieldDescriber,
    private readonly cancelBackend: (pid: number) => Promise<void>,
  ) {
    client.on('notice', (notice) => {
      const severity = notice.severity === 'WARNING' ? 'warning' : 'notice';
      this.currentSink?.message(severity, notice.message ?? '');
    });
  }

  async setSchema(schema: string | undefined): Promise<void> {
    if (schema === this.schema) return;
    // Esquema elegido primero y `public` como respaldo (funciones y extensiones comunes).
    const path =
      !schema || schema === 'public' ? '"$user", public' : `${quoteIdent('postgres', schema)}, public`;
    await this.client.query("SELECT set_config('search_path', $1, false)", [path]).catch((err: unknown) => {
      throw toDriverError(err);
    });
    this.schema = schema;
  }

  async execute(sql: string, maxRows: number | null, sink: StatementSink): Promise<StatementOutcome> {
    await this.closeCursor();
    await this.beginIfManual();
    this.currentSink = sink;
    const cursor = this.client.query(
      new Cursor<CellValue[]>(sql, undefined, { rowMode: 'array', types: sessionTypes }),
    );
    const open: OpenCursor = { cursor, lookahead: null };
    try {
      let loaded = 0;
      let described = false;
      let result: pg.QueryResult | null = null;
      for (;;) {
        const want = maxRows === null ? ROW_BATCH_SIZE : Math.min(ROW_BATCH_SIZE, maxRows - loaded);
        // Alcanzado el límite: se lee una fila más para saber si el resultado está truncado.
        const batch = await readBatch(cursor, want > 0 ? want : 1);
        result = batch.result;
        if (!described) {
          described = true;
          if (result.fields.length > 0) sink.columns(await this.describe(result.fields));
        }
        if (want <= 0) {
          if (batch.rows.length === 0) break;
          open.lookahead = batch.rows[0]!;
          this.open = open;
          return { command: 'SELECT', rowCount: loaded, truncated: true };
        }
        if (batch.rows.length > 0) sink.rows(batch.rows);
        loaded += batch.rows.length;
        if (batch.rows.length < want) break;
      }
      const command = result?.command ?? '';
      const affected = DML.has(command) ? (result?.rowCount ?? undefined) : undefined;
      return {
        command,
        rowCount: result && result.fields.length > 0 ? loaded : (affected ?? 0),
        affected: affected ?? undefined,
        truncated: false,
      };
    } catch (err) {
      throw toDriverError(err);
    } finally {
      if (this.open !== open) await cursor.close().catch(() => undefined);
    }
  }

  async fetchMore(count: number | null, sink: StatementSink): Promise<{ loaded: number; hasMore: boolean }> {
    const open = this.open;
    if (!open) return { loaded: 0, hasMore: false };
    this.currentSink = sink;
    let loaded = 0;
    try {
      if (open.lookahead) {
        sink.rows([open.lookahead]);
        open.lookahead = null;
        loaded = 1;
      }
      for (;;) {
        const want = count === null ? ROW_BATCH_SIZE : Math.min(ROW_BATCH_SIZE, count - loaded);
        const batch = await readBatch(open.cursor, want > 0 ? want : 1);
        if (want <= 0) {
          if (batch.rows.length === 0) break;
          open.lookahead = batch.rows[0]!;
          return { loaded, hasMore: true };
        }
        if (batch.rows.length > 0) sink.rows(batch.rows);
        loaded += batch.rows.length;
        if (batch.rows.length < want) break;
      }
    } catch (err) {
      await this.closeCursor();
      throw toDriverError(err);
    }
    await this.closeCursor();
    return { loaded, hasMore: false };
  }

  async closeCursor(): Promise<void> {
    const open = this.open;
    this.open = null;
    if (open) await open.cursor.close().catch(() => undefined);
  }

  async setAutoCommit(on: boolean): Promise<void> {
    if (on === !this.manual) return;
    if (on) await this.commit();
    this.manual = !on;
  }

  async commit(): Promise<void> {
    await this.closeCursor();
    if (this.client.getTransactionStatus() !== 'I') await this.simple('COMMIT');
  }

  async rollback(): Promise<void> {
    await this.closeCursor();
    if (this.client.getTransactionStatus() !== 'I') await this.simple('ROLLBACK');
  }

  async run(sql: string, params: CellValue[] = [], types: LogicalType[] = []): Promise<number> {
    await this.closeCursor();
    await this.beginIfManual();
    try {
      const values = params.map((v, i) => paramValue(v, types[i]));
      const result = await this.client.query({ text: sql, values, types: sessionTypes });
      return result.rowCount ?? 0;
    } catch (err) {
      throw toDriverError(err);
    }
  }

  /** En modo manual, abre la transacción antes de la primera sentencia. */
  private async beginIfManual(): Promise<void> {
    if (this.manual && this.client.getTransactionStatus() === 'I') await this.simple('BEGIN');
  }

  private async simple(sql: string): Promise<void> {
    await this.client.query(sql).catch((err: unknown) => {
      throw toDriverError(err);
    });
  }

  async cancel(): Promise<void> {
    const pid = (this.client as unknown as { processID: number | null }).processID;
    if (pid === null) throw new DriverError('No se pudo identificar la sesión a cancelar');
    await this.cancelBackend(pid);
  }

  async close(): Promise<void> {
    await this.closeCursor();
    await this.client.end().catch(() => undefined);
  }
}
