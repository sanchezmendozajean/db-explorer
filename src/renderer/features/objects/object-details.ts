import type { ObjectKind, TableDetails } from '@shared/metadata';

/** Objeto de una base, como lo identifica la pestaña de objeto. */
export interface ObjectRefData {
  database: string;
  schema: string;
  name: string;
  kind: ObjectKind;
}

/**
 * Columnas, índices y restricciones de tablas (pestaña Estructura y clave
 * para editar en la grilla), cacheados por conexión hasta refrescar.
 */
const cache = new Map<string, Promise<TableDetails>>();

const keyOf = (connectionId: string, ref: ObjectRefData): string =>
  JSON.stringify([connectionId, ref.database, ref.schema, ref.name, ref.kind]);

export function tableDetails(connectionId: string, ref: ObjectRefData): Promise<TableDetails> {
  const key = keyOf(connectionId, ref);
  let pending = cache.get(key);
  if (!pending) {
    pending = window.api.meta.table({ connectionId, ...ref }).then((r) => {
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    });
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
  }
  return pending;
}

/** Olvida los detalles de un objeto (o de toda una conexión) para volver a pedirlos. */
export function invalidateDetails(connectionId: string, ref?: ObjectRefData): void {
  if (ref) {
    cache.delete(keyOf(connectionId, ref));
    return;
  }
  for (const key of cache.keys()) if ((JSON.parse(key) as string[])[0] === connectionId) cache.delete(key);
}

/** Columnas de la clave para editar: la PK o, si no hay, el primer índice único sin columnas nulas. */
export function keyColumnsOf(details: TableDetails): string[] | null {
  const primary = details.indexes.find((i) => i.primary);
  if (primary) return primary.columns;
  const pkColumns = details.columns.filter((c) => c.primaryKey).map((c) => c.name);
  if (pkColumns.length > 0) return pkColumns;
  const notNull = new Set(details.columns.filter((c) => !c.nullable).map((c) => c.name));
  const unique = details.indexes.find((i) => i.unique && i.columns.every((c) => notNull.has(c)));
  return unique ? unique.columns : null;
}
