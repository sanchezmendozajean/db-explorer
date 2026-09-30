import type {
  ExecuteRequest,
  ExecuteSummary,
  FetchMoreRequest,
  FetchMoreResult,
  QueryEvent,
} from '@shared/query';
import type { DbDriver, DbSession, StatementSink } from './drivers/types';
import { DriverError } from './drivers/types';

interface SessionEntry {
  connectionId: string;
  database: string | undefined;
  session: DbSession;
  /** Ejecución en curso (una por sesión). */
  running: { queryId: string; cancelled: boolean } | null;
  /** Sentencia cuyo cursor quedó abierto para "Cargar más". */
  openCursor: { queryId: string; statementIndex: number } | null;
}

export type EmitQueryEvent = (event: QueryEvent) => void;

/**
 * Sesiones de editor (una por pestaña) y ejecución de sentencias con
 * resultados en lotes (specs/03 §Sesiones, specs/02 §Contrato IPC).
 */
export class QueryRunner {
  private readonly sessions = new Map<string, SessionEntry>();
  /** Sesión de cada consulta en curso o con cursor abierto. */
  private readonly queries = new Map<string, string>();

  constructor(
    private readonly driverOf: (connectionId: string) => DbDriver,
    private readonly emit: EmitQueryEvent,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async execute(req: ExecuteRequest): Promise<ExecuteSummary> {
    const entry = await this.sessionFor(req);
    if (entry.running) {
      throw new DriverError('La pestaña ya está ejecutando una consulta', 'busy');
    }
    const run = { queryId: req.queryId, cancelled: false };
    entry.running = run;
    this.forgetCursor(entry);
    this.queries.set(req.queryId, req.sessionId);
    const started = this.now();
    let executed = 0;
    let failed = false;
    try {
      await entry.session.closeCursor();
      await entry.session.setSchema(req.schema);
      for (let index = 0; index < req.statements.length; index++) {
        if (run.cancelled) break;
        executed++;
        const statementStart = this.now();
        this.emit({ type: 'statement-start', queryId: req.queryId, index, startedAt: Date.now() });
        try {
          const outcome = await entry.session.execute(
            req.statements[index]!,
            req.maxRows,
            this.sink(req.queryId, index),
          );
          const isLast = index === req.statements.length - 1;
          const hasMore = outcome.truncated && isLast;
          if (hasMore) entry.openCursor = { queryId: req.queryId, statementIndex: index };
          else if (outcome.truncated) await entry.session.closeCursor();
          this.emit({
            type: 'statement-done',
            queryId: req.queryId,
            index,
            command: outcome.command,
            rowCount: outcome.rowCount,
            affected: outcome.affected,
            truncated: outcome.truncated,
            hasMore,
            durationMs: Math.round(this.now() - statementStart),
          });
        } catch (err) {
          failed = true;
          const e = err instanceof DriverError ? err : new DriverError(String(err));
          this.emit({
            type: 'statement-error',
            queryId: req.queryId,
            index,
            message: e.message,
            detail: e.extra.detail,
            hint: e.extra.hint,
            position: e.extra.position,
            code: e.code,
            cancelled: run.cancelled,
            durationMs: Math.round(this.now() - statementStart),
          });
          break;
        }
      }
    } finally {
      entry.running = null;
      if (entry.openCursor?.queryId !== req.queryId) this.queries.delete(req.queryId);
    }
    const summary: ExecuteSummary = {
      queryId: req.queryId,
      executed,
      failed,
      cancelled: run.cancelled,
      durationMs: Math.round(this.now() - started),
    };
    this.emit({ type: 'execution-done', queryId: req.queryId, summary });
    return summary;
  }

  async fetchMore(req: FetchMoreRequest): Promise<FetchMoreResult> {
    const sessionId = this.queries.get(req.queryId);
    const entry = sessionId ? this.sessions.get(sessionId) : undefined;
    const cursor = entry?.openCursor;
    if (!entry || !cursor || cursor.queryId !== req.queryId || cursor.statementIndex !== req.statementIndex) {
      throw new DriverError(
        'El resultado ya no tiene filas pendientes (vuelve a ejecutar la consulta)',
        'no-cursor',
      );
    }
    if (entry.running) throw new DriverError('La pestaña ya está ejecutando una consulta', 'busy');
    const run = { queryId: req.queryId, cancelled: false };
    entry.running = run;
    const done = (result: FetchMoreResult | null, error?: string): void =>
      this.emit({ type: 'fetch-done', queryId: req.queryId, index: req.statementIndex, result, error });
    try {
      const result = await entry.session.fetchMore(req.count, this.sink(req.queryId, req.statementIndex));
      if (!result.hasMore) this.forgetCursor(entry);
      done(result);
      return result;
    } catch (err) {
      this.forgetCursor(entry);
      const error = run.cancelled ? new DriverError('Carga cancelada', 'cancelled') : err;
      done(null, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      entry.running = null;
    }
  }

  async cancel(queryId: string): Promise<void> {
    const sessionId = this.queries.get(queryId);
    const entry = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!entry?.running || entry.running.queryId !== queryId) return;
    entry.running.cancelled = true;
    await entry.session.cancel();
  }

  async closeSession(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    this.sessions.delete(sessionId);
    this.forgetCursor(entry);
    if (entry.running) await entry.session.cancel().catch(() => undefined);
    await entry.session.close().catch(() => undefined);
  }

  /** Cierra todas las sesiones de una conexión (al desconectarla o editarla). */
  async closeConnection(connectionId: string): Promise<void> {
    const ids = [...this.sessions].filter(([, e]) => e.connectionId === connectionId).map(([id]) => id);
    await Promise.all(ids.map((id) => this.closeSession(id)));
  }

  private async sessionFor(req: ExecuteRequest): Promise<SessionEntry> {
    const existing = this.sessions.get(req.sessionId);
    if (existing) {
      const sameTarget =
        existing.connectionId === req.connectionId && (existing.database ?? '') === (req.database ?? '');
      if (sameTarget) return existing;
      if (existing.running) throw new DriverError('La pestaña ya está ejecutando una consulta', 'busy');
      await this.closeSession(req.sessionId);
    }
    const driver = this.driverOf(req.connectionId);
    const session = await driver.openSession(req.database, req.schema);
    const entry: SessionEntry = {
      connectionId: req.connectionId,
      database: req.database,
      session,
      running: null,
      openCursor: null,
    };
    this.sessions.set(req.sessionId, entry);
    return entry;
  }

  private forgetCursor(entry: SessionEntry): void {
    if (entry.openCursor) this.queries.delete(entry.openCursor.queryId);
    entry.openCursor = null;
  }

  private sink(queryId: string, index: number): StatementSink {
    return {
      columns: (columns) => this.emit({ type: 'columns', queryId, index, columns }),
      rows: (rows) => this.emit({ type: 'rows', queryId, index, rows }),
      message: (severity, text) => this.emit({ type: 'message', queryId, index, severity, text }),
    };
  }
}
