import { create } from 'zustand';
import { withoutKey } from '@shared/records';
import type { SqlDialect } from '@shared/splitter';
import { analyzeStatement } from '@shared/splitter';
import { es } from '../../i18n/es';
import { showToast } from '../../stores/toast-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import { askChoice } from '../dialogs/ask';
import { addMessage, setLoadingMore, tabResults } from '../results/results-store';

/**
 * Modo de transacción por pestaña (specs/04 §8): Auto (auto-commit) o Manual
 * con Commit/Rollback y el contador de sentencias pendientes. La sesión del
 * db-host recibe el modo con cada ejecución.
 */

interface TabTransaction {
  manual: boolean;
  /** Sentencias de escritura desde el último Commit/Rollback. */
  pending: number;
}

interface TransactionStore {
  byTab: Record<string, TabTransaction>;
}

const AUTO: TabTransaction = { manual: false, pending: 0 };

export const useTransactionStore = create<TransactionStore>(() => ({ byTab: {} }));

export function transactionOf(tabId: string | undefined): TabTransaction {
  return (tabId && useTransactionStore.getState().byTab[tabId]) || AUTO;
}

export function useTransaction(tabId: string | undefined): TabTransaction {
  return useTransactionStore((s) => (tabId && s.byTab[tabId]) || AUTO);
}

export function isManual(tabId: string | undefined): boolean {
  return transactionOf(tabId).manual;
}

function put(tabId: string, changes: Partial<TabTransaction>): void {
  useTransactionStore.setState((s) => ({
    byTab: { ...s.byTab, [tabId]: { ...transactionOf(tabId), ...changes } },
  }));
}

export function addPendingStatements(tabId: string, n: number): void {
  if (isManual(tabId) && n > 0) put(tabId, { pending: transactionOf(tabId).pending + n });
}

/**
 * Cuenta las escrituras ejecutadas en modo manual; un `COMMIT` o `ROLLBACK`
 * escrito por el usuario vuelve el contador a cero.
 */
export function trackExecuted(tabId: string, statements: readonly string[], dialect: SqlDialect): void {
  if (!isManual(tabId)) return;
  let pending = transactionOf(tabId).pending;
  for (const sql of statements) {
    const info = analyzeStatement(sql, dialect);
    if (['commit', 'rollback', 'end'].includes(info.keyword)) pending = 0;
    else if (info.isWrite) pending++;
  }
  put(tabId, { pending });
}

export function forgetTransaction(tabId: string): void {
  useTransactionStore.setState((s) => ({ byTab: withoutKey(s.byTab, tabId) }));
}

/** Commit cierra el cursor de "Cargar más" en el motor: se quita la opción de la grilla. */
function dropCursors(tabId: string): void {
  for (const r of tabResults(tabId).results) if (r.hasMore) setLoadingMore(tabId, r.id, false, false);
}

/** Commit o Rollback de la transacción de la pestaña. */
export async function endTransaction(tabId: string, commit: boolean): Promise<boolean> {
  const r = await window.api.query.endTransaction({ sessionId: tabId, commit });
  if (!r.ok) {
    showToast('error', r.error.message);
    return false;
  }
  put(tabId, { pending: 0 });
  dropCursors(tabId);
  addMessage(tabId, { kind: 'info', text: commit ? es.transactions.committed : es.transactions.rolledBack });
  return true;
}

/** Pregunta qué hacer con la transacción abierta: Commit / Rollback / Cancelar. */
async function askPending(
  tabIds: readonly string[],
  cancelLabel: string = es.dialogs.cancel,
): Promise<boolean> {
  const open = tabIds.filter((id) => transactionOf(id).pending > 0);
  if (open.length === 0) return true;
  const tabs = useWorkbenchStore.getState().tabs;
  const answer = await askChoice({
    title: es.transactions.openTitle,
    message:
      open.length === 1
        ? es.transactions.openOne(transactionOf(open[0]).pending)
        : es.transactions.openMany(open.length),
    items: open.length > 1 ? open.map((id) => tabs.find((t) => t.id === id)?.title ?? id) : undefined,
    buttons: [
      { value: 'commit', label: es.transactions.commit, variant: 'primary' },
      { value: 'rollback', label: es.transactions.rollback },
      { value: 'cancel', label: cancelLabel },
    ],
  });
  if (answer !== 'commit' && answer !== 'rollback') return false;
  for (const id of open) if (!(await endTransaction(id, answer === 'commit'))) return false;
  return true;
}

/** Antes de cerrar pestañas (o la app) con transacciones abiertas. Devuelve false si se cancela. */
export function confirmOpenTransactions(tabIds: readonly string[]): Promise<boolean> {
  return askPending(tabIds);
}

/** Cambia entre Auto y Manual; pasar a Auto con cambios pendientes pregunta Commit/Rollback. */
export async function setTransactionMode(tabId: string, manual: boolean): Promise<void> {
  if (isManual(tabId) === manual) return;
  if (!manual && !(await askPending([tabId]))) return;
  put(tabId, { manual, pending: 0 });
}
