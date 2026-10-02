import type { ResultColumn } from '@shared/query';
import { es } from '../../i18n/es';
import { connectionById } from '../../stores/connections-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import { effectiveTarget } from '../editor/target-pickers';
import type { ObjectRefData } from '../objects/object-details';
import { keyColumnsOf, tableDetails } from '../objects/object-details';
import type { EditableInfo } from './edit-state';
import { tabResults, updateResult } from './results-store';

/**
 * ¿Se puede editar un resultado? (specs/06 §Edición de datos, D7): debe venir
 * de una sola tabla e incluir todas las columnas de su clave primaria (o de
 * un índice único no nulo). En la pestaña de objeto la tabla ya se conoce.
 */

const r = es.results.edit.readOnly;

function sameName(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase();
}

/** Tabla de origen común de las columnas del resultado (`null` si hay más de una o ninguna). */
function sourceTable(columns: readonly ResultColumn[]): { schema?: string; table: string } | null {
  const sourced = columns.filter((c) => c.sourceTable);
  if (sourced.length === 0) return null;
  const first = sourced[0]!;
  const same = sourced.every(
    (c) => c.sourceTable === first.sourceTable && c.sourceSchema === first.sourceSchema,
  );
  return same ? { schema: first.sourceSchema, table: first.sourceTable! } : null;
}

export async function resolveEditable(tabId: string, resultId: string): Promise<void> {
  const tab = useWorkbenchStore.getState().tabs.find((t) => t.id === tabId);
  const result = tabResults(tabId).results.find((x) => x.id === resultId);
  const conn = connectionById(tab?.connectionId);
  if (!tab || !result || !conn) return;
  const readOnly = (reason: string): void =>
    updateResult(tabId, resultId, { editable: null, readOnlyReason: reason });

  if (conn.readOnly) return readOnly(r.connection(conn.name));
  let ref: ObjectRefData;
  let columnNames: (string | null)[];
  if (tab.kind === 'object' && tab.object) {
    if (tab.object.kind !== 'table') return readOnly(r.view);
    ref = tab.object;
    columnNames = result.columns.map((c) => c.name);
  } else {
    const source = sourceTable(result.columns);
    if (!source) {
      return readOnly(result.columns.some((c) => c.sourceTable) ? r.severalTables : r.unknownTable);
    }
    const target = effectiveTarget(tab);
    const database =
      conn.engine === 'mariadb'
        ? (source.schema ?? target.database ?? '')
        : conn.engine === 'sqlite'
          ? 'main'
          : (target.database ?? '');
    ref = {
      database,
      schema: conn.engine === 'sqlite' ? 'main' : (source.schema ?? target.schema ?? ''),
      name: source.table,
      kind: 'table',
    };
    columnNames = result.columns.map((c) =>
      c.sourceTable === source.table && c.sourceSchema === source.schema ? (c.sourceColumn ?? c.name) : null,
    );
  }

  let keys: string[] | null;
  try {
    keys = keyColumnsOf(await tableDetails(conn.id, ref));
  } catch (err) {
    return readOnly(r.noDetails(err instanceof Error ? err.message : String(err)));
  }
  if (!keys) return readOnly(r.noKey(ref.name));
  const keyColumns = keys.map((k) => columnNames.findIndex((n) => n !== null && sameName(n, k)));
  const missing = keys.filter((_, i) => keyColumns[i]! < 0);
  if (missing.length > 0) return readOnly(r.keyMissing(missing.join(', ')));
  const info: EditableInfo = {
    engine: conn.engine,
    table: { database: ref.database, schema: ref.schema, name: ref.name },
    columnNames,
    keyColumns,
  };
  updateResult(tabId, resultId, { editable: info, readOnlyReason: undefined });
}
