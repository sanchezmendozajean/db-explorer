import type { WorkspaceInfo } from '@shared/workspace';
import { es } from '../../i18n/es';
import { useFilesStore } from '../../stores/files-store';
import { useOverlayStore } from '../../stores/overlay-store';
import { setting } from '../../stores/settings-store';
import { showToast } from '../../stores/toast-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { askChoice } from '../dialogs/ask';
import { allDocuments, fileName, isDirty, pendingSaves, saveAll } from '../editor/documents';
import { discardAllTabs, loadWorkspaceTabs, saveWorkspaceStateNow } from '../editor/scripts';

/**
 * Espacio de trabajo (specs/11 §2): abrir al iniciar (con el aviso de carpeta
 * no disponible), cambiar a otra carpeta, recientes y volver al predeterminado.
 */

/** Muestra un espacio ya abierto en main: árbol, título y pestañas guardadas. */
function apply(info: WorkspaceInfo): void {
  useWorkspaceStore.getState().set(info.path, info.name);
  document.title = es.app.windowTitle(info.name);
  useFilesStore.getState().setRoot(info.path);
  loadWorkspaceTabs(info.state, info.missing);
  void window.api.workspace
    .recent({})
    .then((r) => r.ok && useWorkspaceStore.getState().setRecent(r.data.paths));
}

/** Abre el espacio configurado al iniciar. Si la carpeta no está, se pregunta qué hacer (después de pintar). */
export async function restoreWorkspace(): Promise<void> {
  const r = await window.api.workspace.open({});
  if (!r.ok) {
    showToast('error', es.scripts.workspaceFailed(r.error.message));
    return;
  }
  if (r.data.unavailable) {
    const missing = r.data.path;
    // El aviso es un diálogo de la interfaz: se muestra cuando la ventana ya está pintada.
    setTimeout(() => void resolveUnavailable(missing), 0);
    return;
  }
  apply(r.data);
}

/** "No se encuentra el espacio de trabajo": Reintentar, Elegir otra carpeta o Usar el predeterminado. */
async function resolveUnavailable(path: string): Promise<void> {
  for (;;) {
    const answer = await askChoice({
      title: es.workspace.unavailableTitle,
      message: es.workspace.unavailable(path),
      buttons: [
        { value: 'retry', label: es.workspace.retry, variant: 'primary' },
        { value: 'choose', label: es.workspace.chooseOther },
        { value: 'default', label: es.workspace.useDefault },
      ],
    });
    if (answer === 'retry') {
      const r = await window.api.workspace.open({});
      if (r.ok && !r.data.unavailable) return apply(r.data);
      continue;
    }
    if (answer === 'choose') {
      const picked = await window.api.workspace.pickFolder({ title: es.workspace.chooseTitle });
      if (!picked.ok || !picked.data.path) continue;
      const r = await window.api.workspace.switch({ path: picked.data.path });
      if (r.ok) return apply(r.data);
      showToast('error', es.scripts.workspaceFailed(r.error.message));
      continue;
    }
    // "Usar el predeterminado" (o cerrar el aviso): no se borra `workspace.path` (specs/11 §2).
    const r = await window.api.workspace.open({ useDefault: true });
    if (r.ok) apply(r.data);
    else showToast('error', es.scripts.workspaceFailed(r.error.message));
    return;
  }
}

/**
 * Antes de dejar el espacio actual: con guardado automático se guarda todo;
 * sin él se pregunta (Guardar todo / No guardar / Cancelar). Devuelve false
 * si el usuario canceló o algo no se pudo guardar.
 */
async function prepareLeave(): Promise<boolean> {
  const dirty = allDocuments().filter((d) => isDirty(d));
  if (setting('files.autoSave')) {
    const ok = await saveAll();
    await pendingSaves();
    if (!ok) showToast('error', es.workspace.saveFailed);
    return ok;
  }
  if (dirty.length === 0) return true;
  const answer = await askChoice({
    title: es.workspace.leaveTitle,
    message: es.scripts.closeAppMessage(dirty.length),
    items: dirty.map((d) => fileName(d.path)),
    buttons: [
      { value: 'save', label: es.scripts.saveAll, variant: 'primary' },
      { value: 'discard', label: es.scripts.dontSave },
      { value: 'cancel', label: es.dialogs.cancel },
    ],
  });
  if (answer === 'save') return saveAll();
  return answer === 'discard';
}

/**
 * Cambia al espacio de `path` (`null` = el predeterminado): guarda, guarda el
 * estado de pestañas del actual, cierra las pestañas y abre las del nuevo.
 * Los scripts no se mueven de carpeta.
 */
export async function switchWorkspace(path: string | null): Promise<void> {
  if (!(await prepareLeave())) return;
  await saveWorkspaceStateNow();
  const r = await window.api.workspace.switch({ path });
  if (!r.ok) {
    showToast('error', es.scripts.workspaceFailed(r.error.message));
    return;
  }
  discardAllTabs();
  apply(r.data);
}

/** Archivo › Cambiar espacio de trabajo…: diálogo nativo de carpeta. */
export async function changeWorkspace(): Promise<void> {
  const picked = await window.api.workspace.pickFolder({ title: es.workspace.chooseTitle });
  if (picked.ok && picked.data.path) await switchWorkspace(picked.data.path);
}

/** Archivo › Abrir espacio reciente: lista de los últimos 10 (sin el actual). */
export async function openRecentWorkspace(): Promise<void> {
  const r = await window.api.workspace.recent({});
  const current = useWorkspaceStore.getState().path.toLowerCase();
  const paths = r.ok ? r.data.paths.filter((p) => p.toLowerCase() !== current) : [];
  if (paths.length === 0) {
    showToast('info', es.workspace.noRecent);
    return;
  }
  useOverlayStore.getState().openPick({
    placeholder: es.workspace.recentPlaceholder,
    items: paths.map((p) => ({
      id: p,
      label: fileName(p),
      icon: 'folder',
      detail: p,
      run: () => void switchWorkspace(p),
    })),
  });
}

/** Volver al espacio predeterminado (`Documentos\DB Explorer`). */
export function resetWorkspace(): Promise<void> {
  return switchWorkspace(null);
}

export async function revealWorkspace(): Promise<void> {
  const root = useWorkspaceStore.getState().path;
  if (root) await window.api.fs.reveal({ path: root });
}
