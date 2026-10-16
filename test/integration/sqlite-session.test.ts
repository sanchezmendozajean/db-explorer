import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { newConnectionDefaults } from '@shared/connection';
import type { StatementSink } from '../../src/db-host/drivers/types';
import { DriverError } from '../../src/db-host/drivers/types';
import { SqliteDriver } from '../../src/db-host/drivers/sqlite/sqlite-driver';

const dir = mkdtempSync(join(tmpdir(), 'dbx-sqlite-'));
const sink: StatementSink = { columns: () => undefined, rows: () => undefined, message: () => undefined };

/** Cuenta enorme: tarda lo suficiente para cancelarla a mitad. */
const SLOW =
  'with recursive s(n) as (select 1 union all select n + 1 from s where n < 30000000) select count(*) from s';

// El hilo cancelado puede seguir unos instantes dentro de SQLite con el archivo abierto (Windows no lo deja borrar).
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch {
    // Queda en la carpeta temporal del sistema.
  }
});

async function open(manual: boolean) {
  const driver = new SqliteDriver();
  await driver.connect({
    ...newConnectionDefaults('sqlite', 'lt'),
    file: join(dir, `t-${manual ? 'm' : 'a'}.db`),
    sqliteCreate: true,
  });
  const session = await driver.openSession();
  if (manual) await session.setAutoCommit(false);
  return { driver, session };
}

describe('SQLite: cancelar termina la sesión', () => {
  it('en modo manual avisa que la transacción abierta se perdió', async () => {
    const { driver, session } = await open(true);
    await session.execute('create table if not exists t (id integer)', null, sink);
    await session.execute('insert into t values (1)', null, sink);
    const running = session.execute(SLOW, null, sink);
    setTimeout(() => void session.cancel(), 200);
    const error = (await running.catch((e: unknown) => e)) as DriverError;
    expect(error).toBeInstanceOf(DriverError);
    expect(error.code).toBe('cancelled');
    expect(error.extra.transactionLost).toBe(true);
    await session.close();
    await driver.disconnect();
  });

  it('en auto-commit no hay transacción que perder', async () => {
    const { driver, session } = await open(false);
    const running = session.execute(SLOW, null, sink);
    setTimeout(() => void session.cancel(), 200);
    const error = (await running.catch((e: unknown) => e)) as DriverError;
    expect(error.code).toBe('cancelled');
    expect(error.extra.transactionLost).toBeUndefined();
    await session.close();
    await driver.disconnect();
  });
});
