import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Pruebas de integración contra los motores levantados con
 * `docker compose -f test/integration/docker-compose.yml up -d` o, si no hay
 * Docker, contra un clúster temporal creado con los binarios locales de PostgreSQL.
 */
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 120_000,
    globalSetup: ['test/integration/global-setup.ts'],
    fileParallelism: false,
  },
});
