import type { ExportFormat, ExportRequest } from '@shared/query';
import { analyzeStatement } from '@shared/splitter';
import { encodeAll, markdownEncoder } from '@shared/export';
import { qualifiedName, quoteIdent } from '@shared/sql-quote';
import { es } from '../../i18n/es';
import { connectionById } from '../../stores/connections-store';
import { useOverlayStore } from '../../stores/overlay-store';
import { setting } from '../../stores/settings-store';
import { showToast, useToastStore } from '../../stores/toast-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import { ensureConnected } from '../connections/actions';
import type { ExportChoice } from './ExportDialog';
import type { ResultSet } from './results-store';
import { onExportProgress, tabResults } from './results-store';
import { visibleColumns, visibleRows } from './view';

/**
 * Exportar un resultado a archivo (specs/06 §Otros formatos): las filas
 * cargadas o, si está truncado, la consulta re-ejecutada sin límite en flujo
 * desde el db-host, con avance y cancelación en una notificación.
 */

function askExport(options: {
  format: ExportFormat;
  loaded: number;
  truncated: boolean;
  canRerun: boolean;
  defaultTable: string;
}): Promise<ExportChoice | null> {
  return new Promise((resolve) => {
    useOverlayStore.getState().openDialog({ id: 'export', ...options, onResult: resolve });
  });
}

/** Sentencia de solo lectura que generó el resultado (se puede re-ejecutar sin límite). */
function rerunnableSql(result: ResultSet, engine: Parameters<typeof analyzeStatement>[1]): string | null {
  const sql = result.statementSql;
  if (!sql) return null;
  return analyzeStatement(sql, engine).isWrite ? null : sql;
}

function fileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'resultado';
}

/** "Copiar como Markdown" del menú Exportar: toda la tabla cargada, con orden y filtro. */
function copyMarkdown(result: ResultSet): void {
  const cols = visibleColumns(result.columns, result.view);
  const order = visibleRows(result.rows, result.columns, result.view);
  const rows = (order ?? result.rows.map((_, i) => i)).map((i) =>
    cols.map((c) => result.rows[i]![c] ?? null),
  );
  const text = encodeAll(
    markdownEncoder(
      cols.map((c) => result.columns[c]!),
      { nullAs: setting('format.null') },
    ),
    rows,
  );
  void window.api.app.clipboardWrite({ text }).then((r) => {
    if (!r.ok) showToast('error', r.error.message);
    else if (result.truncated) showToast('info', es.results.copiedTruncated(rows.length));
  });
}

export async function exportResult(
  tabId: string,
  resultId: string,
  format: ExportFormat | 'markdown',
): Promise<void> {
  const tab = useWorkbenchStore.getState().tabs.find((t) => t.id === tabId);
  const result = tabResults(tabId).results.find((r) => r.id === resultId);
  const conn = connectionById(tab?.connectionId);
  if (!tab || !result || !conn) return;
  if (format === 'markdown') {
    copyMarkdown(result);
    return;
  }
  const sql = rerunnableSql(result, conn.engine);
  const engine = conn.engine;
  const table = result.editable
    ? qualifiedName(engine, {
        schema: engine === 'sqlite' ? undefined : result.editable.table.schema,
        name: result.editable.table.name,
      })
    : quoteIdent(engine, result.title);
  const choice = await askExport({
    format,
    loaded: result.rows.length,
    truncated: result.truncated,
    canRerun: !!sql,
    defaultTable: table,
  });
  if (!choice) return;
  const picked = await window.api.data.pickExportPath({ format, defaultName: fileName(result.title) });
  if (!picked.ok || !picked.data.path) return;
  const path = picked.data.path;

  const cols = visibleColumns(result.columns, result.view);
  const object = tab.kind === 'object' ? tab.object : undefined;
  let source: ExportRequest['source'];
  if (choice.all && sql) {
    if (!(await ensureConnected(conn.id))) return;
    source = {
      kind: 'query',
      sessionId: tabId,
      connectionId: conn.id,
      database: object ? object.database : tab.database,
      schema: object ? object.schema : tab.schema,
      sql,
      columnIndexes: cols,
    };
  } else {
    const order = visibleRows(result.rows, result.columns, result.view);
    const indices = order ?? result.rows.map((_, i) => i);
    source = { kind: 'rows', rows: indices.map((i) => cols.map((c) => result.rows[i]![c] ?? null)) };
  }

  const exportId = crypto.randomUUID();
  const toasts = useToastStore.getState();
  const toastId = showToast(
    'info',
    es.results.exportProgress(0),
    [{ label: es.dialogs.cancel, run: () => void window.api.query.cancel({ queryId: exportId }) }],
    { sticky: true },
  );
  const stop = onExportProgress(exportId, (rows) => toasts.update(toastId, es.results.exportProgress(rows)));
  const r = await window.api.data.export({
    exportId,
    path,
    format,
    options: {
      separator: choice.separator,
      header: choice.header,
      bom: choice.bom,
      table: choice.table,
      engine,
    },
    columns: cols.map((c) => result.columns[c]!),
    source,
  });
  stop();
  toasts.dismiss(toastId);
  if (!r.ok) showToast('error', es.results.exportFailed(r.error.message));
  else if (r.data.cancelled) showToast('info', es.results.exportCancelled);
  else showToast('success', es.results.exported(r.data.rows, path));
}
