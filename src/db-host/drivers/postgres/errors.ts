import { DriverError } from '../types';

/** Convierte errores de `pg`/red en mensajes presentables sin datos sensibles. */
export function toDriverError(err: unknown): DriverError {
  if (err instanceof DriverError) return err;
  const e = err as { message?: string; code?: string; position?: string; detail?: string; hint?: string };
  const message = e?.message ?? String(err);
  const position = e?.position ? Number(e.position) : undefined;
  return new DriverError(message, e?.code, {
    position: Number.isFinite(position) ? position : undefined,
    detail: e?.detail || undefined,
    hint: e?.hint || undefined,
  });
}
