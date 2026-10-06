import { defineConfig } from '@playwright/test';

/**
 * Checklist e2e sobre el programa empaquetado (specs/09 M9): `npm run test:packaged`
 * empaqueta en `dist/win-unpacked` y recorre el flujo completo con el .exe.
 */
export default defineConfig({
  testDir: 'test/e2e-packaged',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
  globalSetup: './test/e2e/global-setup.ts',
});
