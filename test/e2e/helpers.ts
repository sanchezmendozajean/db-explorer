import { _electron as electron } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export function tempUserData(): string {
  return mkdtempSync(join(tmpdir(), 'dbx-e2e-'));
}

/** Lanza el build (`out/`) con un `userData` aislado. */
export async function launchApp(userDataDir: string = tempUserData()): Promise<ElectronApplication> {
  // Terminales integradas de VS Code heredan ELECTRON_RUN_AS_NODE=1, que haría arrancar Electron como Node.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[0] !== 'ELECTRON_RUN_AS_NODE' && entry[1] !== undefined,
    ),
  );
  env['DBX_USER_DATA_DIR'] = userDataDir;
  return electron.launch({ args: [resolve(__dirname, '../../out/main/index.js')], env });
}

export interface PgE2eConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** Configuración del PostgreSQL de pruebas (definida por global-setup). */
export function pgConfig(): PgE2eConfig {
  return JSON.parse(process.env['DBX_PG'] ?? '{}') as PgE2eConfig;
}
