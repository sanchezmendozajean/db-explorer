import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fuentes e íconos empaquetados en la app: nunca se descargan (ver specs/NOTAS.md).
import '@vscode/codicons/dist/codicon.css';
import '@fontsource/cascadia-code/latin-400.css';
import '@fontsource/cascadia-code/latin-400-italic.css';
import '@fontsource/cascadia-code/latin-600.css';
import './theme/base.css';
import './theme/workbench.css';
import './theme/components.css';
import { App } from './app/App';
import { registerAppCommands } from './app/app-commands';
import { applyUserKeybindings, installKeybindingHandler } from './commands/service';
import type { UserKeybindings } from '@shared/keybindings';
import { es } from './i18n/es';
import { startUiStatePersistence, useUiStore } from './stores/ui-store';
import { showToast } from './stores/toast-store';
import { useConnectionsStore } from './stores/connections-store';
import { useSettingsStore } from './stores/settings-store';
import { handleBeforeClose, startWorkspacePersistence } from './features/editor/scripts';
import { restoreWorkspace } from './features/files/workspace-actions';
import { catalogScope, startCatalogPreload } from './features/editor/catalog';
import { effectiveTarget } from './features/editor/target-pickers';
import { activeTab } from './stores/workbench-store';
import { handleExternalChanges } from './features/editor/documents';
import { useFilesStore } from './stores/files-store';
import {
  applyQueryEvent,
  positionInStatement,
  resetAllRunning,
  setExecutionCallbacks,
} from './features/results/results-store';
import { markError } from './features/execution/execute';
import { resolveEditable } from './features/results/editable';

async function bootstrap(): Promise<void> {
  // El estado de UI se carga antes del primer render para no parpadear tamaños ni tema.
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  useUiStore.getState().setSystemDark(media.matches);
  media.addEventListener('change', (e) => useUiStore.getState().setSystemDark(e.matches));

  const response = await window.api.app.getUiState({});
  if (response.ok) useUiStore.getState().hydrate(response.data);
  document.documentElement.dataset['theme'] = useUiStore.getState().effectiveTheme;
  startUiStatePersistence();

  const settings = await window.api.settings.get({});
  if (settings.ok) useSettingsStore.getState().hydrate(settings.data);
  window.api.on('settings:changed', (next) => useSettingsStore.getState().hydrate(next));

  registerAppCommands();
  installKeybindingHandler();
  // Atajos de keybindings.json: al iniciar y cada vez que se guarda (specs/05 §Personalización).
  const applyKeybindings = (kb: UserKeybindings): void => {
    applyUserKeybindings(kb.rules);
    if (kb.invalid > 0) showToast('warning', es.toasts.keybindingsInvalid(kb.invalid));
  };
  const kb = await window.api.settings.getKeybindings({});
  if (kb.ok) applyKeybindings(kb.data);
  window.api.on('settings:keybindings-changed', applyKeybindings);

  window.api.on('app:db-host-restarted', () => {
    useConnectionsStore.getState().resetSessions();
    resetAllRunning();
    showToast('warning', es.toasts.dbHostRestarted);
  });

  // Filas, mensajes y errores de las consultas en curso (llegan en lotes desde el db-host).
  window.api.on('query:event', applyQueryEvent);
  setExecutionCallbacks({
    onStatementError: (tabId, meta, event) => {
      if (!meta || event.cancelled) return;
      const pos =
        event.position !== undefined
          ? positionInStatement(meta, event.position)
          : { line: meta.startLine, column: meta.startColumn };
      markError(tabId, pos.line, pos.column, event.message);
    },
    onResultDone: (tabId, resultId) => void resolveEditable(tabId, resultId),
  });

  // Conexiones antes que el espacio de trabajo: las pestañas restauradas muestran su conexión.
  const skipped = await useConnectionsStore.getState().load();
  if (skipped > 0) showToast('warning', es.connections.skippedEntries(skipped));

  // Cambios en disco (watcher de main): árbol de archivos y documentos abiertos.
  window.api.on('fs:changed', ({ paths }) => {
    void useFilesStore.getState().refresh(paths);
    void handleExternalChanges(paths);
  });

  await restoreWorkspace();
  // Catálogo del esquema de la pestaña activa en segundo plano (autocompletado y Ctrl+P).
  startCatalogPreload(() => {
    const tab = activeTab();
    const target = effectiveTarget(tab);
    return catalogScope(tab?.connectionId, target.database, target.schema);
  });
  startWorkspacePersistence();

  // Al cerrar la ventana se guardan los scripts y el estado del espacio (specs/11 §4).
  window.api.on('app:before-close', () => void handleBeforeClose());
  void window.api.app.closeReady({ phase: 'listening' });

  const container = document.getElementById('root');
  if (!container) throw new Error('No se encontró el elemento raíz');
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
