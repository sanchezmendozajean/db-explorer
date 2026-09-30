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
import { installKeybindingHandler, commands } from './commands/service';
import { es } from './i18n/es';
import { SAMPLE_WORKSPACE } from './sample/sample-data';
import { startUiStatePersistence, useUiStore } from './stores/ui-store';
import { showToast } from './stores/toast-store';
import { useWorkbenchStore } from './stores/workbench-store';
import { useSampleStore } from './stores/sample-store';
import { useConnectionsStore } from './stores/connections-store';

async function bootstrap(): Promise<void> {
  // El estado de UI se carga antes del primer render para no parpadear tamaños ni tema.
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  useUiStore.getState().setSystemDark(media.matches);
  media.addEventListener('change', (e) => useUiStore.getState().setSystemDark(e.matches));

  const response = await window.api.app.getUiState({});
  if (response.ok) useUiStore.getState().hydrate(response.data);
  document.documentElement.dataset['theme'] = useUiStore.getState().effectiveTheme;
  startUiStatePersistence();

  registerAppCommands();
  installKeybindingHandler();

  // Solo en desarrollo: alternar datos de ejemplo para revisar los estados vacíos.
  if (import.meta.env.DEV) {
    commands.register({
      id: 'db.dev.toggleSampleData',
      category: es.dev.category,
      title: es.dev.toggleSampleData,
      run: () => useSampleStore.getState().toggle(),
    });
  }

  // Pestañas de ejemplo (pantalla 1 de la maqueta). En M3 se restauran las del espacio de trabajo.
  const wb = useWorkbenchStore.getState();
  wb.open({
    id: 'script:Script-1',
    kind: 'script',
    title: 'Script-1',
    tooltip: `${SAMPLE_WORKSPACE.path}\\Script-1.sql`,
    connectionId: 'local',
    dirty: false,
    preview: false,
  });
  wb.open({
    id: 'script:Script-2',
    kind: 'script',
    title: 'Script-2',
    tooltip: `${SAMPLE_WORKSPACE.path}\\Script-2.sql`,
    connectionId: 'paybox-prod',
    dirty: true,
    preview: false,
  });
  wb.open({
    id: 'object:pb/paybox/public/tables/CRendiciones_Conf_Generales',
    kind: 'object',
    title: 'CRendiciones_Conf_Generales',
    tooltip: 'PayBox Prod › paybox › public › CRendiciones_Conf_Generales',
    connectionId: 'paybox-prod',
    dirty: false,
    preview: true,
  });
  wb.activate('script:Script-2');

  document.title = es.app.windowTitle(SAMPLE_WORKSPACE.name);

  window.api.on('app:db-host-restarted', () => {
    useConnectionsStore.getState().resetSessions();
    showToast('warning', es.toasts.dbHostRestarted);
  });

  const skipped = await useConnectionsStore.getState().load();
  if (skipped > 0) showToast('warning', es.connections.skippedEntries(skipped));

  const container = document.getElementById('root');
  if (!container) throw new Error('No se encontró el elemento raíz');
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
