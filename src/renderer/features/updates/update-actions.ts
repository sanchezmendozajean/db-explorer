import { es } from '../../i18n/es';
import { showToast, useToastStore } from '../../stores/toast-store';
import { useUpdateStore } from '../../stores/update-store';

const t = es.updates;

/**
 * Búsqueda manual: una sola notificación que pasa de "Buscando…" (con indicador animado) al
 * resultado; el engranaje se actualiza solo con el estado de main.
 */
export async function checkForUpdate(): Promise<void> {
  const { replace, dismiss } = useToastStore.getState();
  const id = showToast('info', t.checking, undefined, { loading: true });
  const r = await window.api.updates.check({});
  if (!r.ok) {
    replace(id, { severity: 'error', message: r.error.message });
    return;
  }
  useUpdateStore.getState().setStatus(r.data);
  const s = r.data;
  if (s.state === 'none') replace(id, { severity: 'success', message: t.upToDate });
  else if (s.state === 'downloading') replace(id, { severity: 'info', message: t.downloading(s.version) });
  else if (s.state === 'ready') replace(id, { severity: 'success', message: t.ready(s.version) });
  else if (s.state === 'error') replace(id, { severity: 'error', message: t.failed(s.message) });
  else if (s.state === 'unsupported') replace(id, { severity: 'info', message: t.unsupported });
  else dismiss(id);
}

export async function installUpdate(): Promise<void> {
  const r = await window.api.updates.install({});
  if (!r.ok) showToast('error', r.error.message);
}

/** Estado inicial y suscripción a los cambios que informa main. */
export async function startUpdateStatus(): Promise<void> {
  window.api.on('updates:status', (status) => useUpdateStore.getState().setStatus(status));
  const r = await window.api.updates.getStatus({});
  if (r.ok) useUpdateStore.getState().setStatus(r.data);
}
