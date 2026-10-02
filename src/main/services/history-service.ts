import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { HistoryEntry, HistoryQuery } from '@shared/history';
import type { ExecuteRequest, QueryEvent } from '@shared/query';

/** Una de cada cuántas inserciones se recorta el historial a `maxEntries`. */
const PRUNE_EVERY = 50;

interface Options {
  enabled: () => boolean;
  maxEntries: () => number;
  /** Nombre y motor de una conexión (se guardan con la entrada por si después se borra). */
  connection: (id: string) => { name: string; engine: string } | undefined;
}

interface Pending {
  request: ExecuteRequest;
  startedAt: Map<number, number>;
}

/**
 * Historial de consultas (specs/06 §Mensajes e historial): una fila por
 * sentencia ejecutada en `userData/history.sqlite`. Es el único lugar donde
 * se guarda texto SQL (specs/08); se desactiva con `history.enabled`.
 */
export class HistoryService {
  private readonly db: DatabaseSync;
  private readonly pending = new Map<string, Pending>();
  private inserts = 0;

  constructor(
    file: string,
    private readonly options: Options,
  ) {
    mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY,
        at INTEGER NOT NULL,
        connection_id TEXT NOT NULL,
        connection_name TEXT NOT NULL,
        engine TEXT NOT NULL,
        database_name TEXT,
        sql TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        rows INTEGER,
        ok INTEGER NOT NULL,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS history_at ON history (at DESC);
    `);
  }

  /** Se va a ejecutar: se recuerda el texto de cada sentencia para registrarla al terminar. */
  begin(request: ExecuteRequest): void {
    if (!this.options.enabled()) return;
    this.pending.set(request.queryId, { request, startedAt: new Map() });
  }

  /** Eventos del db-host: registra cada sentencia al terminar (bien, con error o cancelada). */
  onEvent(event: QueryEvent): void {
    const pending = this.pending.get(event.queryId);
    if (!pending) return;
    switch (event.type) {
      case 'statement-start':
        pending.startedAt.set(event.index, event.startedAt);
        break;
      case 'statement-done':
        this.insert(pending, event.index, {
          durationMs: event.durationMs,
          rows: event.affected ?? event.rowCount,
          ok: true,
        });
        break;
      case 'statement-error':
        this.insert(pending, event.index, {
          durationMs: event.durationMs,
          ok: false,
          error: event.cancelled ? 'Cancelada' : event.message,
        });
        break;
      case 'execution-done':
        this.pending.delete(event.queryId);
        break;
      default:
        break;
    }
  }

  list(query: HistoryQuery): HistoryEntry[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (query.text?.trim()) {
      where.push("sql LIKE ? ESCAPE '\\'");
      params.push(`%${query.text.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    if (query.connectionId) {
      where.push('connection_id = ?');
      params.push(query.connectionId);
    }
    params.push(Math.min(query.limit ?? 1000, 5000));
    const rows = this.db
      .prepare(
        `SELECT id, at, connection_id, connection_name, engine, database_name, sql, duration_ms, rows, ok, error
           FROM history ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY id DESC LIMIT ?`,
      )
      .all(...params) as Record<string, string | number | null>[];
    return rows.map((r) => ({
      id: Number(r['id']),
      at: Number(r['at']),
      connectionId: String(r['connection_id']),
      connectionName: String(r['connection_name']),
      engine: String(r['engine']),
      database: r['database_name'] === null ? undefined : String(r['database_name']),
      sql: String(r['sql']),
      durationMs: Number(r['duration_ms']),
      rows: r['rows'] === null ? undefined : Number(r['rows']),
      ok: Number(r['ok']) === 1,
      error: r['error'] === null ? undefined : String(r['error']),
    }));
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM history WHERE id = ?').run(id);
  }

  clear(): void {
    this.db.exec('DELETE FROM history');
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  private insert(
    pending: Pending,
    index: number,
    result: { durationMs: number; rows?: number; ok: boolean; error?: string },
  ): void {
    const { request } = pending;
    const sql = request.statements[index];
    if (sql === undefined || !this.options.enabled()) return;
    const conn = this.options.connection(request.connectionId);
    this.db
      .prepare(
        `INSERT INTO history (at, connection_id, connection_name, engine, database_name, sql, duration_ms, rows, ok, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        pending.startedAt.get(index) ?? Date.now(),
        request.connectionId,
        conn?.name ?? '',
        conn?.engine ?? '',
        request.database ?? null,
        sql,
        Math.round(result.durationMs),
        result.rows ?? null,
        result.ok ? 1 : 0,
        result.error ?? null,
      );
    if (++this.inserts % PRUNE_EVERY === 1) this.prune();
  }

  /** Conserva solo las `maxEntries` entradas más recientes. */
  private prune(): void {
    this.db
      .prepare('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT ?)')
      .run(this.options.maxEntries());
  }
}
