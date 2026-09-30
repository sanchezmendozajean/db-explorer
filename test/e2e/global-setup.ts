import pg from 'pg';
import { ensurePostgres, PG_FIXTURE_SQL } from '../integration/pg-server';

/**
 * Levanta (o reutiliza) el PostgreSQL de pruebas para los e2e y pasa su
 * configuración a los tests por variables de entorno.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const server = await ensurePostgres();
  const client = new pg.Client(server.config);
  await client.connect();
  await client.query(PG_FIXTURE_SQL);
  await client.end();
  process.env['DBX_PG'] = JSON.stringify(server.config);
  return () => server.stop();
}
