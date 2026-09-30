import type { TestProject } from 'vitest/node';
import type { PgTestConfig } from './pg-server';
import { ensurePostgres } from './pg-server';

/** Levanta (o reutiliza) el PostgreSQL de pruebas y expone su configuración a los tests. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const server = await ensurePostgres();
  project.provide('pg', server.config);
  return () => server.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    pg: PgTestConfig;
  }
}
