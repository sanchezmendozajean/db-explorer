import { DriverError } from '../types';
import { positionOfSnippet } from '../common';

interface TediousError {
  message?: string;
  code?: string;
  number?: number;
  lineNumber?: number;
  errors?: TediousError[];
}

/**
 * Convierte errores de `tedious` en mensajes presentables. La posición se
 * deduce de la línea que informa el servidor y del fragmento citado
 * ("Incorrect syntax near 'FORM'"). Nunca incluye credenciales.
 */
export function toSqlServerError(err: unknown, sql = ''): DriverError {
  if (err instanceof DriverError) return err;
  const e = err as TediousError;
  // Varios errores en un mismo lote llegan como AggregateError.
  const all = Array.isArray(e?.errors) && e.errors.length > 0 ? e.errors : [e];
  const first = all[0] ?? e;
  const message = all.map((x) => x?.message ?? String(x)).join('\n');
  const near = /near (?:the keyword )?'([^']*)'/.exec(first?.message ?? '')?.[1];
  const code = first?.number !== undefined ? String(first.number) : first?.code;
  const position = sql ? positionOfSnippet(sql, near, first?.lineNumber) : undefined;
  return new DriverError(message || String(err), code, { position });
}
