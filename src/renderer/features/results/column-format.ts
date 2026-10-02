import { withoutKey } from '@shared/records';
import type { ColumnFormat } from '@shared/settings';
import { connectionById } from '../../stores/connections-store';
import { setting, useSettingsStore } from '../../stores/settings-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import { effectiveTarget } from '../editor/target-pickers';
import type { ResultSet } from './results-store';
import { tabResults, updateResult } from './results-store';

/**
 * Formato por columna desde la grilla (specs/06): se guarda en la vista del
 * resultado y, con "Recordar", en `format.columns` de settings.json con la
 * clave `conexión/base/esquema/tabla/columna`.
 */

/** Clave para recordar el formato de una columna; `null` si no se conoce su tabla de origen. */
export function columnFormatKey(tabId: string, result: ResultSet, column: number): string | null {
  const tab = useWorkbenchStore.getState().tabs.find((t) => t.id === tabId);
  const conn = connectionById(tab?.connectionId);
  const col = result.columns[column];
  if (!tab || !conn || !col) return null;
  if (tab.kind === 'object' && tab.object) {
    const o = tab.object;
    return [conn.name, o.database, o.schema, o.name, col.name].join('/');
  }
  if (!col.sourceTable) return null;
  const target = effectiveTarget(tab);
  const database =
    conn.engine === 'mariadb'
      ? (col.sourceSchema ?? '')
      : conn.engine === 'sqlite'
        ? 'main'
        : target.database;
  const schema = conn.engine === 'sqlite' ? 'main' : (col.sourceSchema ?? target.schema);
  return [conn.name, database ?? '', schema ?? '', col.sourceTable, col.sourceColumn ?? col.name].join('/');
}

/** Formato efectivo de cada columna: el de la vista o, si no, el recordado. */
export function columnFormats(tabId: string, result: ResultSet): (ColumnFormat | undefined)[] {
  const remembered = setting('format.columns');
  return result.columns.map((_, c) => {
    if (c in result.view.formats) return result.view.formats[c];
    const key = Object.keys(remembered).length > 0 ? columnFormatKey(tabId, result, c) : null;
    return key ? remembered[key] : undefined;
  });
}

/** Aplica (o quita, con `null`) el formato de una columna; con `remember`, también en settings.json. */
export async function setColumnFormat(
  tabId: string,
  resultId: string,
  column: number,
  format: ColumnFormat | null,
  remember: boolean,
): Promise<void> {
  const result = tabResults(tabId).results.find((r) => r.id === resultId);
  if (!result) return;
  const key = columnFormatKey(tabId, result, column);
  const remembered = setting('format.columns');
  // Sin formato propio en la vista vale el recordado (o el global).
  let formats = withoutKey(result.view.formats, column);
  if (remember && key) {
    const all = format ? { ...remembered, [key]: format } : withoutKey(remembered, key);
    await useSettingsStore.getState().update('format.columns', all);
  } else if (format) {
    formats = { ...formats, [column]: format };
  } else if (key && remembered[key]) {
    // "Restablecer" también olvida el formato recordado.
    await useSettingsStore.getState().update('format.columns', withoutKey(remembered, key));
  }
  updateResult(tabId, resultId, { view: { ...result.view, formats }, version: result.version + 1 });
}
