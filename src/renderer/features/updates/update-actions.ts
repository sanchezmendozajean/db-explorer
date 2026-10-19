import { es } from '../../i18n/es';
import { showToast } from '../../stores/toast-store';
import { useUpdateStore } from '../../stores/update-store';

const t = es.updates;

/** Búsqueda manual: avisa del resultado; el engranaje se actualiza solo con el estado de main. */
export async function checkForUpdate(): Promise<void> {
  showToast('info', t.checking);
  const r = await window.api.updates.check({});
  if (!r.ok) {
    showToast('error', r.error.message);
    return;
  }
  useUpdateStore.getState().setStatus(r.data);
  const s = r.data;
  if (s.state === 'none') showToast('success', t.upToDate);
  else if (s.state === 'downloading') showToast('info', t.downloading(s.version));
  else if (s.state === 'ready') showToast('success', t.ready(s.version));
  else if (s.state === 'error') showToast('error', t.failed(s.message));
  else if (s.state === 'unsupported') showToast('info', t.unsupported);
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
