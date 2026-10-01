import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Variables de las pruebas de integración: `test/integration/.env` (local,
 * ignorado por git) sobre `.env.example`, y las del entorno por encima de ambos.
 */
export function testEnv(): (key: string, fallback?: string) => string | undefined {
  const values: Record<string, string> = {};
  for (const name of ['.env.example', '.env']) {
    const file = resolve(__dirname, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) values[m[1]!] = m[2]!;
    }
  }
  return (key, fallback) => process.env[key] ?? values[key] ?? fallback;
}
