import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Pruebas de integración contra los motores levantados con
 * `docker compose -f test/integration/docker-compose.yml up -d`.
 */
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    passWithNoTests: true,
  },
});
