import type * as NodeSqlite from 'node:sqlite';
import type * as WorkerThreads from 'node:worker_threads';
import type { CellValue, LogicalType, ResultColumn } from '@shared/query';

/**
 * Hilo de una sesión de editor de SQLite. `node:sqlite` es síncrono y no se
 * puede interrumpir: cada sesión corre en su propio `worker_thread` para no
 * bloquear el db-host y para poder cancelar terminando el hilo (specs/03).
 *
 * `sqliteWorkerMain` se ejecuta con `new Worker(código, { eval: true })`, así
 * que no puede usar nada de fuera de la función: ni imports ni constantes del
 * módulo (solo tipos, que desaparecen al compilar).
 */

export interface SqliteWorkerData {
  file: string;
  readOnly: boolean;
  busyTimeoutMs: number;
  batchSize: number;
}

export type SqliteWorkerRequest =
  | { type: 'execute'; sql: string; maxRows: number | null; dml: boolean }
  | { type: 'fetch'; count: number | null }
  | { type: 'close-cursor' };

export type SqliteWorkerMessage =
  | { type: 'ready'; version: string }
  | { type: 'columns'; columns: ResultColumn[] }
  | { type: 'rows'; rows: CellValue[][] }
  | { type: 'done'; rowCount: number; affected?: number; truncated: boolean }
  | { type: 'fetched'; loaded: number; hasMore: boolean }
  | { type: 'error'; message: string; code?: string };

export function sqliteWorkerMain(): void {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { parentPort, workerData } = require('node:worker_threads') as typeof WorkerThreads;
  const { DatabaseSync } = require('node:sqlite') as typeof NodeSqlite;
  /* eslint-enable @typescript-eslint/no-require-imports */
  const data = workerData as SqliteWorkerData;
  const post = (message: SqliteWorkerMessage): void => parentPort!.postMessage(message);

  let db: InstanceType<typeof DatabaseSync>;
  try {
    db = new DatabaseSync(data.file, { readOnly: data.readOnly, timeout: data.busyTimeoutMs });
  } catch (err) {
    post({ type: 'error', message: (err as Error).message });
    return;
  }

  /** Cursor abierto ("Cargar más"): iterador y una fila leída de más para saber si quedaban. */
  let cursor: { iterator: Iterator<unknown[]>; lookahead: unknown[] | null } | null = null;
  const pkCache = new Map<string, Set<string>>();

  const toCell = (value: unknown): CellValue => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'bigint') {
      const safe = value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER);
      return safe ? Number(value) : value.toString();
    }
    if (value instanceof Uint8Array) {
      return `0x${Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('hex').toUpperCase()}`;
    }
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
    return String(value);
  };

  /** Tipo lógico por el tipo declarado (reglas de afinidad de SQLite) o, en expresiones, por el valor. */
  const logicalType = (declared: string | null, sample: unknown): LogicalType => {
    const t = (declared ?? '').toUpperCase();
    if (t) {
      if (t.includes('BOOL')) return 'boolean';
      if (t.includes('INT')) return 'integer';
      if (t.includes('JSON')) return 'json';
      if (/CHAR|CLOB|TEXT/.test(t)) return 'text';
      if (t.includes('BLOB')) return 'binary';
      if (/REAL|FLOA|DOUB/.test(t)) return 'float';
      if (/DATETIME|TIMESTAMP/.test(t)) return 'datetime';
      if (t.includes('DATE')) return 'date';
      if (t.includes('TIME')) return 'time';
      if (/DEC|NUM|MONEY/.test(t)) return 'decimal';
      if (/UUID|GUID/.test(t)) return 'uuid';
      return 'other';
    }
    if (typeof sample === 'bigint') return 'integer';
    if (typeof sample === 'number') return Number.isInteger(sample) ? 'integer' : 'float';
    if (typeof sample === 'string') return 'text';
    if (sample instanceof Uint8Array) return 'binary';
    return 'other';
  };

  const primaryKeys = (database: string, table: string): Set<string> => {
    const key = `${database}\u0000${table}`;
    let keys = pkCache.get(key);
    if (!keys) {
      keys = new Set();
      try {
        const rows = db
          .prepare('SELECT name FROM pragma_table_info(?, ?) WHERE pk > 0')
          .all(table, database) as { name: string }[];
        for (const r of rows) keys.add(r.name);
      } catch {
        // Sin información de clave la grilla funciona igual.
      }
      pkCache.set(key, keys);
    }
    return keys;
  };

  const closeCursor = (): void => {
    cursor?.iterator.return?.();
    cursor = null;
  };

  /** Lee hasta `count` filas (todas si es `null`) en lotes; con límite, deja el cursor abierto si quedan. */
  const readInto = (
    iterator: Iterator<unknown[]>,
    count: number | null,
    first: unknown[][],
  ): { loaded: number; hasMore: boolean } => {
    let loaded = 0;
    let batch = first;
    for (;;) {
      if (batch.length > 0) {
        post({ type: 'rows', rows: batch.map((row) => row.map(toCell)) });
        loaded += batch.length;
      }
      if (count !== null && loaded >= count) {
        const next = iterator.next();
        if (next.done) return { loaded, hasMore: false };
        cursor = { iterator, lookahead: next.value };
        return { loaded, hasMore: true };
      }
      const want = count === null ? data.batchSize : Math.min(data.batchSize, count - loaded);
      batch = [];
      while (batch.length < want) {
        const next = iterator.next();
        if (next.done) break;
        batch.push(next.value);
      }
      if (batch.length < want) {
        if (batch.length > 0) {
          post({ type: 'rows', rows: batch.map((row) => row.map(toCell)) });
          loaded += batch.length;
        }
        return { loaded, hasMore: false };
      }
    }
  };

  const errorMessage = (err: unknown): SqliteWorkerMessage => {
    const e = err as { message?: string; errstr?: string; code?: string };
    return { type: 'error', message: e?.message ?? String(err), code: e?.code };
  };

  parentPort!.on('message', (request: SqliteWorkerRequest) => {
    try {
      if (request.type === 'close-cursor') {
        closeCursor();
        return;
      }
      if (request.type === 'fetch') {
        const open = cursor;
        if (!open) {
          post({ type: 'fetched', loaded: 0, hasMore: false });
          return;
        }
        cursor = null;
        const first = open.lookahead ? [open.lookahead] : [];
        const result = readInto(open.iterator, request.count, first);
        if (!result.hasMore) open.iterator.return?.();
        post({ type: 'fetched', ...result });
        return;
      }
      closeCursor();
      const stmt = db.prepare(request.sql);
      const columns = stmt.columns();
      if (columns.length === 0) {
        const result = stmt.run();
        const changes = Number(result.changes);
        post({
          type: 'done',
          rowCount: request.dml ? changes : 0,
          affected: request.dml ? changes : undefined,
          truncated: false,
        });
        return;
      }
      stmt.setReturnArrays(true);
      stmt.setReadBigInts(true);
      const iterator = stmt.iterate() as Iterator<unknown[]>;
      // El primer lote se lee antes de describir las columnas para deducir el tipo de las expresiones.
      const want = request.maxRows === null ? data.batchSize : Math.min(data.batchSize, request.maxRows);
      const first: unknown[][] = [];
      while (first.length < want) {
        const next = iterator.next();
        if (next.done) break;
        first.push(next.value);
      }
      post({
        type: 'columns',
        columns: columns.map((c, i) => {
          const sourced = c.table && c.column ? { database: c.database ?? 'main', table: c.table } : null;
          return {
            name: c.name,
            nativeType: c.type ?? '',
            logicalType: logicalType(c.type, first[0]?.[i]),
            sourceSchema: sourced?.database,
            sourceTable: sourced?.table,
            sourceColumn: c.column ?? undefined,
            isPk: sourced ? primaryKeys(sourced.database, sourced.table).has(c.column!) : undefined,
          };
        }),
      });
      const exhausted = first.length < want;
      const result = exhausted
        ? (() => {
            if (first.length > 0) post({ type: 'rows', rows: first.map((row) => row.map(toCell)) });
            return { loaded: first.length, hasMore: false };
          })()
        : readInto(iterator, request.maxRows, first);
      post({ type: 'done', rowCount: result.loaded, truncated: result.hasMore });
    } catch (err) {
      closeCursor();
      post(errorMessage(err));
    }
  });

  const version = (db.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v;
  post({ type: 'ready', version });
}
