import { tokenize } from '@shared/splitter';
import type { SqlDialect } from '@shared/splitter';

/**
 * Utilidades compartidas por los drivers que no reciben del motor la
 * etiqueta del comando (MariaDB, SQLite y SQL Server).
 */

/** Primera palabra clave de la sentencia en mayúsculas (`SELECT`, `UPDATE`…), como etiqueta del resultado. */
export function commandOf(sql: string, dialect: SqlDialect): string {
  const word = tokenize(sql, dialect).find((t) => t.kind === 'word');
  return word ? word.value.toUpperCase() : '';
}

/** Comandos cuyo número de filas afectadas tiene sentido mostrar. */
const DML = new Set(['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'REPLACE', 'UPSERT']);

export function isDml(command: string): boolean {
  return DML.has(command);
}

/** Binario como texto `0x…` (formato de literal de SQL Server, MariaDB y SQLite). */
export function hexText(bytes: Uint8Array): string {
  return `0x${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex').toUpperCase()}`;
}

/**
 * Posición 1-based del fragmento que cita un error ("near 'x'") dentro de la
 * sentencia, buscando desde el inicio de la línea indicada si se conoce.
 */
export function positionOfSnippet(
  sql: string,
  snippet: string | undefined,
  line?: number,
): number | undefined {
  let from = 0;
  if (line && line > 1) {
    for (let i = 1; i < line; i++) {
      const eol = sql.indexOf('\n', from);
      if (eol < 0) break;
      from = eol + 1;
    }
  }
  if (snippet) {
    const at = sql.indexOf(snippet, from);
    if (at >= 0) return at + 1;
  }
  return line && line > 1 ? from + 1 : undefined;
}

/** Filas estimadas abreviadas para el árbol ("1,2 k", "3,4 M"). */
export function formatRowEstimate(estimate: number): string | undefined {
  if (!(estimate >= 0)) return undefined;
  if (estimate < 1000) return String(Math.round(estimate));
  if (estimate < 1_000_000)
    return `${(estimate / 1000).toLocaleString('es', { maximumFractionDigits: 1 })} k`;
  return `${(estimate / 1_000_000).toLocaleString('es', { maximumFractionDigits: 1 })} M`;
}
