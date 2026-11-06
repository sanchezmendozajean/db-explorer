import { describe, expect, it, vi } from 'vitest';
import type { QueryEvent } from '../../src/shared/query';
import { QueryRunner } from '../../src/db-host/query-runner';
import type { DbDriver, DbSession, StatementSink } from '../../src/db-host/drivers/types';
import { withTimeout } from '../../src/db-host/drivers/common';
import { watchSuspension } from '../../src/db-host/suspension-watch';

/** Sesión de mentira cuya conexión está "muerta": ni ejecutar, ni cancelar, ni cerrar responden. */
class DeadSession implements Partial<DbSession> {
  readonly database = 'db';
  abandoned = false;
  alive = true;
  /** Hace que `execute` se cuelgue mientras la conexión esté muerta. */
  async execute(_sql: string, _max: number | null, sink: StatementSink) {
    if (!this.alive) await new Promise<never>(() => undefined);
    sink.rows([[1]]);
    return { command: 'SELECT', rowCount: 1, truncated: false };
  }
  async setSchema(): Promise<void> {}
  async closeCursor(): Promise<void> {}
  async setAutoCommit(): Promise<void> {}
  cancel(): Promise<void> {
    return this.alive ? Promise.resolve() : new Promise<never>(() => undefined);
  }
  abandon(): void {
    this.abandoned = true;
  }
  ping(): Promise<void> {
    return this.alive ? Promise.resolve() : new Promise<never>(() => undefined);
  }
  close(): Promise<void> {
    return this.alive ? Promise.resolve() : new Promise<never>(() => undefined);
  }
}

function setup() {
  const sessions: DeadSession[] = [];
  const driver = {
    engine: 'postgres',
    openSession: async () => {
      const s = new DeadSession();
      sessions.push(s);
      return s as unknown as DbSession;
    },
  } as unknown as DbDriver;
  const events: QueryEvent[] = [];
  const runner = new QueryRunner(
    () => driver,
    (e) => events.push(e),
    () => performance.now(),
    { cancelGraceMs: 50, pingMs: 50, closeMs: 50 },
  );
  const req = (queryId: string, autoCommit = true) => ({
    queryId,
    sessionId: 's1',
    connectionId: 'c1',
    statements: ['select 1'],
    maxRows: null,
    autoCommit,
  });
  return { runner, sessions, events, req };
}

describe('QueryRunner con la conexión caída', () => {
  it('Detener libera la pestaña aunque el servidor no responda', async () => {
    const { runner, sessions, events, req } = setup();
    await runner.execute(req('q0')); // abre la sesión
    sessions[0]!.alive = false;
    const running = runner.execute(req('q1'));
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'statement-start' && e.queryId === 'q1')).toBe(true),
    );

    await runner.cancel('q1');
    const summary = await running;

    expect(summary).toMatchObject({ cancelled: true, failed: true });
    expect(sessions[0]!.abandoned).toBe(true);
    const error = events.find((e) => e.type === 'statement-error' && e.queryId === 'q1');
    expect(error).toMatchObject({ cancelled: true });
    // La siguiente ejecución abre una sesión nueva y funciona.
    const next = await runner.execute(req('q2'));
    expect(next.failed).toBe(false);
    expect(sessions).toHaveLength(2);
  });

  it('Detener con transacción manual abierta informa que se perdió', async () => {
    const { runner, sessions, events, req } = setup();
    await runner.execute(req('q0', false));
    sessions[0]!.alive = false;
    const running = runner.execute(req('q1', false));
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'statement-start' && e.queryId === 'q1')).toBe(true),
    );
    await runner.cancel('q1');
    await running;
    expect(events.find((e) => e.type === 'statement-error' && e.queryId === 'q1')).toMatchObject({
      transactionLost: true,
    });
  });

  it('tras una suspensión reconecta con una sesión nueva antes de ejecutar', async () => {
    const { runner, sessions, events, req } = setup();
    await runner.execute(req('q0'));
    sessions[0]!.alive = false;
    runner.markStale();

    const summary = await runner.execute(req('q1'));

    expect(summary.failed).toBe(false);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.abandoned).toBe(true);
    expect(events.some((e) => e.type === 'message' && e.queryId === 'q1' && e.severity === 'warning')).toBe(
      true,
    );
  });

  it('tras una suspensión con transacción manual falla y avisa de la pérdida', async () => {
    const { runner, sessions, events, req } = setup();
    await runner.execute(req('q0', false));
    sessions[0]!.alive = false;
    runner.markStale();

    const summary = await runner.execute(req('q1', false));

    expect(summary.failed).toBe(true);
    expect(events.find((e) => e.type === 'statement-error' && e.queryId === 'q1')).toMatchObject({
      transactionLost: true,
    });
    // La sesión nueva queda lista para volver a ejecutar.
    expect((await runner.execute(req('q2', false))).failed).toBe(false);
  });

  it('con la sesión viva la comprobación tras la suspensión no la reemplaza', async () => {
    const { runner, sessions, req } = setup();
    await runner.execute(req('q0'));
    runner.markStale();
    await runner.execute(req('q1'));
    expect(sessions).toHaveLength(1);
  });

  it('cerrar una sesión caída no se queda esperando', async () => {
    const { runner, sessions, req } = setup();
    await runner.execute(req('q0'));
    sessions[0]!.alive = false;
    await runner.closeSession('s1');
    expect(sessions[0]!.abandoned).toBe(true);
  });
});

describe('withTimeout', () => {
  it('rechaza con código timeout y avisa si no hay respuesta', async () => {
    const onTimeout = vi.fn();
    await expect(withTimeout(new Promise(() => undefined), 20, onTimeout)).rejects.toMatchObject({
      code: 'timeout',
    });
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('entrega el resultado si responde a tiempo', async () => {
    await expect(withTimeout(Promise.resolve(5), 1000)).resolves.toBe(5);
  });
});

describe('watchSuspension', () => {
  it('avisa cuando el reloj de pared salta más que el intervalo', () => {
    vi.useFakeTimers();
    try {
      let wall = 0;
      const onResume = vi.fn();
      const stop = watchSuspension(onResume, { intervalMs: 1000, gapMs: 5000, wallClock: () => wall });
      wall += 1000;
      vi.advanceTimersByTime(1000);
      expect(onResume).not.toHaveBeenCalled();
      wall += 60_000; // el equipo durmió un minuto
      vi.advanceTimersByTime(1000);
      expect(onResume).toHaveBeenCalledOnce();
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
