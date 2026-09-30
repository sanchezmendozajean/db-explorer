import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Escribe un archivo de forma atómica: primero a un temporal en la misma
 * carpeta y luego lo renombra sobre el destino. Un corte a mitad de escritura
 * nunca deja el archivo destino truncado.
 */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, data, typeof data === 'string' ? 'utf8' : undefined);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
