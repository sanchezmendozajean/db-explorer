import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * ¿La URL `file:` apunta a `filePath`? Se comparan rutas, no textos de URL:
 * Chromium y Node no codifican igual algunos caracteres (`~` queda tal cual en
 * Chromium y como `%7E` en `pathToFileURL`), y en Windows las mayúsculas no
 * importan. Con la comparación de textos, instalar en una ruta con `~` (p. ej.
 * un nombre corto 8.3 como `JEAN~1`) dejaba todo el IPC rechazado.
 */
export function isFileUrlOf(
  url: string,
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  let path: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;
    parsed.search = '';
    parsed.hash = '';
    path = fileURLToPath(parsed);
  } catch {
    return false;
  }
  const a = resolve(path);
  const b = resolve(filePath);
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
