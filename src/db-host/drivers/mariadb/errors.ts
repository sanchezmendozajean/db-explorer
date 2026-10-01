import { DriverError } from '../types';
import { positionOfSnippet } from '../common';

/**
 * Convierte errores de `mysql2` en mensajes presentables. La posición se toma
 * de "… near 'FROM x' at line 2" (fragmento citado y línea). Nunca incluye
 * credenciales.
 */
export function toMariaDbError(err: unknown, sql = ''): DriverError {
  if (err instanceof DriverError) return err;
  const e = err as { message?: string; sqlMessage?: string; code?: string; errno?: number };
  const message = e?.sqlMessage ?? e?.message ?? String(err);
  const m = /near '([\s\S]*)' at line (\d+)/.exec(message);
  // El fragmento citado puede llegar recortado: basta su primera línea para ubicarlo.
  const snippet = m?.[1]?.split('\n')[0];
  const position = sql && m ? positionOfSnippet(sql, snippet || undefined, Number(m[2])) : undefined;
  return new DriverError(message, e?.code, { position });
}
