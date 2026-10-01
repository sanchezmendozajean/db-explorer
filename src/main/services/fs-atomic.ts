import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

/** Errores de Windows cuando otro proceso tiene el destino abierto un instante (antivirus, indexador, OneDrive…). */
const TRANSIENT_RENAME_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Reintentos del renombrado: ~1,5 s en total, con espera creciente. */
const RENAME_DELAYS_MS = [10, 25, 50, 100, 150, 250, 400, 500];

/** Renombra reintentando mientras el destino esté bloqueado por otro proceso. */
export async function renameWithRetry(
  from: string,
  to: string,
  doRename: (from: string, to: string) => Promise<void> = rename,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await doRename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      const delay = RENAME_DELAYS_MS[attempt];
      if (!TRANSIENT_RENAME_ERRORS.has(code) || delay === undefined) throw err;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

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
    await renameWithRetry(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
