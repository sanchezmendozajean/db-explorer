import type {
  ApplyChangesRequest,
  ApplyChangesResult,
  CellValue,
  ExecuteRequest,
  ExecuteSummary,
  ExportRequest,
  ExportSummary,
  FetchMoreRequest,
  FetchMoreResult,
  QueryEvent,
  SessionTarget,
} from '@shared/query';
import type { ExecutionPlan } from '@shared/plan';
import type { DbDriver, DbSession, ExplainOptions, StatementSink } from './drivers/types';
import { DriverError } from './drivers/types';
import { withTimeout } from './drivers/common';
import { FileExporter } from './export/file-exporter';
import { TRANSACTION_SQL } from './transaction-sql';

/** Filas por lote al exportar re-ejecutando la consulta (se espera al disco entre lotes). */
const EXPORT_CHUNK = 5000;

/** Plazos para tratar con servidores que dejaron de responder (p. ej. tras suspender el equipo). */
export interface RunnerTimings {
  /** Tras pedir la cancelación, espera a que el motor termine la sentencia antes de abandonar la sesión. */
  cancelGraceMs: number;
  /** Máximo de espera a la comprobación de una sesión que podría haber quedado muerta. */
  pingMs: number;
  /** Máximo de espera al cierre ordenado de una sesión. */
  closeMs: number;
}

const DEFAULT_TIMINGS: RunnerTimings = { cancelGraceMs: 5000, pingMs: 3000, closeMs: 3000 };

const LOST_TRANSACTION_MESSAGE =
  'Se restableció la conexión con el servidor: la transacción manual abierta se perdió y no hay cambios pendientes. Vuelve a ejecutar.';
const RESTORED_SESSION_MESSAGE =
  'Se restableció la conexión con el servidor (las variables y tablas temporales de la sesión anterior se perdieron).';

/**
 * Ejecución en curso de una sesión. Además de la bandera de cancelación ofrece una salida de emergencia:
 * `abort` hace fallar cualquier espera protegida con `guard` aunque el servidor ya no conteste.
 */
class Run {
  cancelled = false;
  private rejectAborted!: (err: Error) => void;
  private readonly aborted = new Promise<never>((_, reject) => {
    this.rejectAborted = reject;
  });
  private markFinished!: () => void;
  /** Se resuelve cuando la ejecución terminó (con éxito, con error o abandonada). */
  readonly finished = new Promise<void>((resolve) => {
    this.markFinished = resolve;
  });

  constructor(readonly queryId: string) {
    this.aborted.catch(() => undefined);
  }

  guard<T>(work: Promise<T>): Promise<T> {
    return Promise.race([work, this.aborted]);
  }

  abort(err: Error): void {
    this.rejectAborted(err);
  }

  end(): void {
    this.markFinished();
  }
}

interface SessionEntry {
  connectionId: string;
  database: string | undefined;
  session: DbSession;
  /** Ejecución en curso (una por sesión). */
  running: Run | null;
  /** Sentencia cuyo cursor quedó abierto para "Cargar más". */
  openCursor: { queryId: string; statementIndex: number } | null;
  autoCommit: boolean;
  /** El equipo estuvo suspendido: antes de usar la sesión hay que comprobar que sigue viva. */
  stale: boolean;
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
    timings: Partial<RunnerTimings> = {},
  ) {
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
  }

  private readonly timings: RunnerTimings;

  /** El equipo estuvo suspendido: las conexiones de las sesiones pudieron morir sin aviso. */
  markStale(): void {
    for (const entry of this.sessions.values()) entry.stale = true;
  }

  async execute(req: ExecuteRequest): Promise<ExecuteSummary> {
    let entry = await this.sessionFor(req);
    if (entry.running) {
      throw new DriverError('La pestaña ya está ejecutando una consulta', 'busy');
    }
    // Una sesión que pudo morir durante la suspensión se comprueba antes de enviarle la consulta.
    let revival: { notice: string; error: DriverError | null } | null = null;
    if (entry.stale) {
      const checked = await this.revive(req, entry);
      entry = checked.entry;
      revival = checked.revival;
    }
    const run = new Run(req.queryId);
    entry.running = run;
    this.forgetCursor(entry);
    this.queries.set(req.queryId, req.sessionId);
    const started = this.now();
    let executed = 0;
    let failed = false;
    try {
      await run.guard(entry.session.closeCursor());
      await run.guard(this.applyMode(entry, req.autoCommit));
      await run.guard(entry.session.setSchema(req.schema));
      for (let index = 0; index < req.statements.length; index++) {
        if (run.cancelled) break;
        executed++;
        const statementStart = this.now();
        this.emit({ type: 'statement-start', queryId: req.queryId, index, startedAt: Date.now() });
        try {
          if (revival?.error) throw revival.error;
          if (revival && index === 0) {
            this.emit({
              type: 'message',
              queryId: req.queryId,
              index,
              severity: 'warning',
              text: revival.notice,
            });
          }
          if (req.explain) {
            const plan = await run.guard(
              this.explain(
                entry,
                req.connectionId,
                req.statements[index]!,
                req.explain,
                this.sink(req.queryId, index),
              ),
            );
            if (run.cancelled) throw new DriverError('Consulta cancelada', 'cancelled');
            this.emit({ type: 'plan', queryId: req.queryId, index, plan });
            this.emit({
              type: 'statement-done',
              queryId: req.queryId,
              index,
              command: 'EXPLAIN',
              rowCount: 0,
              truncated: false,
              hasMore: false,
              durationMs: Math.round(this.now() - statementStart),
            });
            continue;
          }
          const outcome = await run.guard(
            entry.session.execute(req.statements[index]!, req.maxRows, this.sink(req.queryId, index)),
          );
          const isLast = index === req.statements.length - 1;
          const hasMore = outcome.truncated && isLast;
          if (hasMore) entry.openCursor = { queryId: req.queryId, statementIndex: index };
          else if (outcome.truncated) await run.guard(entry.session.closeCursor());
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
            transactionLost: e.extra.transactionLost,
            durationMs: Math.round(this.now() - statementStart),
          });
          break;
        }
      }
    } finally {
      entry.running = null;
      run.end();
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
    const run = new Run(req.queryId);
    entry.running = run;
    const done = (result: FetchMoreResult | null, error?: string): void =>
      this.emit({ type: 'fetch-done', queryId: req.queryId, index: req.statementIndex, result, error });
    try {
      const result = await run.guard(
        entry.session.fetchMore(req.count, this.sink(req.queryId, req.statementIndex)),
      );
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
      run.end();
    }
  }

  /**
   * Plan de una sentencia (specs/12 §4). Explicar y ejecutar va siempre
   * dentro de una transacción que se revierte: `BEGIN` … `ROLLBACK` en
   * auto-commit, o un punto de guardado si la pestaña está en modo manual.
   */
  private async explain(
    entry: SessionEntry,
    connectionId: string,
    sql: string,
    options: ExplainOptions,
    sink: StatementSink,
  ): Promise<ExecutionPlan> {
    const s = entry.session;
    const engine = this.driverOf(connectionId).engine;
    // SQLite no tiene plan real: la sesión lo rechaza sin abrir una transacción.
    if (!options.analyze || engine === 'sqlite') return s.explain(sql, options, sink);
    const tx = TRANSACTION_SQL[engine];
    const manual = !entry.autoCommit;
    await s.run(manual ? tx.savepoint : tx.begin);
    try {
      return await s.explain(sql, options, sink);
    } finally {
      if (manual) {
        await s.run(tx.rollbackToSavepoint).catch(() => undefined);
        if (tx.releaseSavepoint) await s.run(tx.releaseSavepoint).catch(() => undefined);
      } else {
        await s.run(tx.rollback).catch(() => undefined);
      }
    }
  }

  /** Commit o Rollback de la transacción abierta en la sesión de una pestaña (modo manual). */
  async endTransaction(sessionId: string, commit: boolean): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    if (entry.running) throw new DriverError('La pestaña ya está ejecutando una consulta', 'busy');
    this.forgetCursor(entry);
    if (commit) await entry.session.commit();
    else await entry.session.rollback();
  }

  /**
   * Guarda los cambios de la grilla (specs/06 §Edición de datos) en una
   * transacción: en auto-commit, `BEGIN` … `COMMIT`; con una transacción
   * manual, dentro de un punto de guardado que queda pendiente de Commit.
   * Ante un error, o si un UPDATE/DELETE no afecta exactamente una fila, se
   * revierte todo.
   */
  async apply(req: ApplyChangesRequest): Promise<ApplyChangesResult> {
    const entry = await this.sessionFor(req);
    if (entry.running) throw new DriverError('La pestaña ya está ejecutando una consulta', 'busy');
    const run = new Run(`guardar:${req.sessionId}`);
    entry.running = run;
    try {
      this.forgetCursor(entry);
      await entry.session.closeCursor();
      await this.applyMode(entry, req.autoCommit);
      await entry.session.setSchema(req.schema);
      const tx = TRANSACTION_SQL[this.driverOf(req.connectionId).engine];
      const manual = !entry.autoCommit;
      const s = entry.session;
      await s.run(manual ? tx.savepoint : tx.begin);
      const undo = async (): Promise<void> => {
        if (!manual) {
          await s.run(tx.rollback).catch(() => undefined);
          return;
        }
        await s.run(tx.rollbackToSavepoint).catch(() => undefined);
        if (tx.releaseSavepoint) await s.run(tx.releaseSavepoint).catch(() => undefined);
      };
      const affected: number[] = [];
      for (let index = 0; index < req.statements.length; index++) {
        const st = req.statements[index]!;
        let n: number;
        try {
          n = await s.run(st.sql, st.params, st.types);
        } catch (err) {
          await undo();
          return { ok: false, index, message: err instanceof Error ? err.message : String(err) };
        }
        if (st.expectOne && n !== 1) {
          await undo();
          return {
            ok: false,
            index,
            message: `La clave no identifica una fila única (${n} filas afectadas)`,
          };
        }
        affected.push(n);
      }
      if (!manual) await s.run(tx.commit);
      else if (tx.releaseSavepoint) await s.run(tx.releaseSavepoint);
      return { ok: true, affected };
    } finally {
      entry.running = null;
      run.end();
    }
  }

  /**
   * Exporta a archivo en flujo (specs/06): las filas ya cargadas que manda el
   * renderer, o la consulta re-ejecutada sin límite en una sesión aparte,
   * leída por lotes y escrita al ritmo del disco.
   */
  async export(req: ExportRequest): Promise<ExportSummary> {
    const exporter = new FileExporter(req.path, req.format, req.options, req.columns);
    const progress = (): void =>
      this.emit({ type: 'export-progress', queryId: req.exportId, rows: exporter.rows });
    try {
      await exporter.begin();
      let cancelled = false;
      if (req.source.kind === 'rows') {
        const rows = req.source.rows;
        for (let i = 0; i < rows.length; i += EXPORT_CHUNK) {
          await exporter.write(rows.slice(i, i + EXPORT_CHUNK));
          progress();
        }
      } else {
        cancelled = await this.exportQuery(req.exportId, req.source, exporter, progress);
      }
      if (cancelled) await exporter.abort();
      else await exporter.end();
      return { rows: exporter.rows, cancelled };
    } catch (err) {
      await exporter.abort();
      throw err;
    }
  }

  /** Re-ejecuta la consulta en la sesión `<pestaña>#exportar` y la escribe por lotes. Devuelve si se canceló. */
  private async exportQuery(
    exportId: string,
    source: SessionTarget & { sql: string; columnIndexes: number[] },
    exporter: FileExporter,
    progress: () => void,
  ): Promise<boolean> {
    const sessionId = `${source.sessionId}#exportar`;
    const entry = await this.sessionFor({ ...source, sessionId, autoCommit: true });
    const run = new Run(exportId);
    entry.running = run;
    this.queries.set(exportId, sessionId);
    let pending: CellValue[][] = [];
    let results = 0;
    const sink: StatementSink = {
      columns: () => {
        results++;
      },
      // Solo el primer resultado de la sentencia, con las columnas visibles en su orden.
      rows: (rows) => {
        if (results !== 1) return;
        for (const row of rows) pending.push(source.columnIndexes.map((i) => row[i] ?? null));
      },
      message: () => undefined,
    };
    const flush = async (): Promise<void> => {
      const rows = pending;
      pending = [];
      await exporter.write(rows);
      progress();
    };
    try {
      await run.guard(entry.session.setSchema(source.schema));
      const outcome = await run.guard(entry.session.execute(source.sql, EXPORT_CHUNK, sink));
      await flush();
      let more = outcome.truncated;
      while (more && !run.cancelled) {
        const r = await run.guard(entry.session.fetchMore(EXPORT_CHUNK, sink));
        await flush();
        more = r.hasMore;
      }
      return run.cancelled;
    } catch (err) {
      if (run.cancelled) return true;
      throw err;
    } finally {
      entry.running = null;
      run.end();
      this.queries.delete(exportId);
      await this.closeSession(sessionId);
    }
  }

  async cancel(queryId: string): Promise<void> {
    const sessionId = this.queries.get(queryId);
    const entry = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!sessionId || !entry?.running || entry.running.queryId !== queryId) return;
    const run = entry.running;
    run.cancelled = true;
    // Cancelación nativa del motor; si el servidor no responde, el error se ignora y se abandona la sesión.
    void entry.session.cancel().catch(() => undefined);
    const finished = await Promise.race([
      run.finished.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), this.timings.cancelGraceMs)),
    ]);
    // El motor no terminó la sentencia (conexión caída sin aviso): se descarta la sesión y se libera la pestaña.
    if (!finished && entry.running === run) this.abandon(sessionId, entry, run);
  }

  /** Descarta la sesión sin esperar al servidor y hace fallar la ejecución en curso como cancelada. */
  private abandon(sessionId: string, entry: SessionEntry, run: Run): void {
    if (this.sessions.get(sessionId) === entry) this.sessions.delete(sessionId);
    this.forgetCursor(entry);
    const lost = !entry.autoCommit;
    run.abort(new DriverError('Consulta cancelada', 'cancelled', lost ? { transactionLost: true } : {}));
    try {
      entry.session.abandon();
    } catch {
      // La conexión ya estaba destruida.
    }
  }

  /**
   * Comprueba que una sesión marcada como dudosa sigue viva. Si no responde se descarta y se abre otra:
   * con una transacción manual abierta la ejecución falla (se perdió), si no, sigue con la sesión nueva.
   */
  private async revive(
    req: SessionTarget,
    entry: SessionEntry,
  ): Promise<{ entry: SessionEntry; revival: { notice: string; error: DriverError | null } | null }> {
    entry.stale = false;
    const alive = await withTimeout(
      entry.session.closeCursor().then(() => entry.session.ping()),
      this.timings.pingMs,
    ).then(
      () => true,
      () => false,
    );
    if (alive) return { entry, revival: null };
    const lost = !entry.autoCommit;
    if (this.sessions.get(req.sessionId) === entry) this.sessions.delete(req.sessionId);
    this.forgetCursor(entry);
    try {
      entry.session.abandon();
    } catch {
      // La conexión ya estaba destruida.
    }
    const fresh = await this.sessionFor(req);
    return {
      entry: fresh,
      revival: {
        notice: RESTORED_SESSION_MESSAGE,
        error: lost
          ? new DriverError(LOST_TRANSACTION_MESSAGE, 'disconnected', { transactionLost: true })
          : null,
      },
    };
  }

  async closeSession(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    this.sessions.delete(sessionId);
    this.forgetCursor(entry);
    if (entry.running) void entry.session.cancel().catch(() => undefined);
    // Con el servidor caído el cierre ordenado no termina nunca: pasado el plazo se destruye la conexión.
    await withTimeout(entry.session.close(), this.timings.closeMs).catch(() => entry.session.abandon());
  }

  /** Cierra todas las sesiones de una conexión (al desconectarla o editarla). */
  async closeConnection(connectionId: string): Promise<void> {
    const ids = [...this.sessions].filter(([, e]) => e.connectionId === connectionId).map(([id]) => id);
    await Promise.all(ids.map((id) => this.closeSession(id)));
  }

  /** Aplica el modo de transacción pedido por la pestaña si cambió. */
  private async applyMode(entry: SessionEntry, autoCommit: boolean | undefined): Promise<void> {
    const on = autoCommit ?? true;
    if (on === entry.autoCommit) return;
    await entry.session.setAutoCommit(on);
    entry.autoCommit = on;
  }

  private async sessionFor(req: SessionTarget): Promise<SessionEntry> {
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
      autoCommit: true,
      stale: false,
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
