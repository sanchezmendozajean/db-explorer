import type { Command } from '../commands/registry';
import { commands } from '../commands/service';
import { es } from '../i18n/es';
import { useUiStore } from '../stores/ui-store';
import { useOverlayStore } from '../stores/overlay-store';
import { useWorkbenchStore } from '../stores/workbench-store';
import { showToast } from '../stores/toast-store';
import { newConnection } from '../features/connections/actions';
import { useSettingsStore } from '../stores/settings-store';
import { activeEditor } from '../features/editor/editor-instance';
import { autoSaveChanged, saveAll, saveDocument } from '../features/editor/documents';
import { closeActiveTab, newScript } from '../features/editor/scripts';
import { pickConnection, pickDatabaseOrSchema } from '../features/editor/target-pickers';
import { cancelExecution, executeFromEditor, isRunning } from '../features/execution/execute';

const cat = es.commandCategories;

function focusArea(selector: string): void {
  const el = document.querySelector<HTMLElement>(selector);
  el?.focus();
}

/** Registra los comandos disponibles en el hito actual. */
export function registerAppCommands(): () => void {
  const ui = useUiStore.getState;
  const overlay = useOverlayStore.getState;
  const wb = useWorkbenchStore.getState;
  const hasTabs = (): boolean => wb().tabs.length > 0;
  const activeScript = (): string | undefined => {
    const tab = wb().tabs.find((t) => t.id === wb().activeId);
    return tab?.kind === 'script' ? tab.id : undefined;
  };
  const hasScript = (): boolean => activeScript() !== undefined;
  const hasSelection = (): boolean => {
    const selection = activeEditor()?.getSelection();
    return hasScript() && !!selection && !selection.isEmpty();
  };
  const settings = useSettingsStore.getState;

  const list: Command[] = [
    { id: 'db.showCommands', category: cat.view, run: () => overlay().openPalette('commands') },
    { id: 'db.quickOpen', category: cat.view, run: () => overlay().openPalette('quickOpen') },

    { id: 'db.toggleSidebar', category: cat.view, run: () => ui().toggleSideBar() },
    { id: 'db.togglePanel', category: cat.view, run: () => ui().togglePanel() },
    {
      id: 'db.maximizePanel',
      category: cat.view,
      run: () => ui().toggleMaximizePanel(),
      checked: () => ui().panel.maximized,
    },
    {
      id: 'db.view.connections',
      category: cat.view,
      run: () => {
        ui().showView('connections');
        requestAnimationFrame(() => focusArea('[data-view="connections"] .tree'));
      },
    },
    {
      id: 'db.view.files',
      category: cat.view,
      run: () => {
        ui().showView('files');
        requestAnimationFrame(() => focusArea('[data-view="files"] .tree'));
      },
    },
    { id: 'db.view.history', category: cat.view, run: () => ui().showView('history') },
    {
      id: 'db.focusEditor',
      category: cat.view,
      run: () => {
        const editor = activeEditor();
        if (editor) editor.focus();
        else focusArea('[data-focus-context~="editorFocus"]');
      },
    },
    {
      id: 'db.focusPanel',
      category: cat.view,
      run: () => {
        if (!ui().panel.visible) ui().togglePanel();
        requestAnimationFrame(() => focusArea('[data-focus-context~="resultsFocus"]'));
      },
    },

    ...(['dark', 'light', 'system'] as const).map((theme): Command => ({
      id: `db.theme.${theme}`,
      category: cat.theme,
      run: () => ui().setTheme(theme),
      checked: () => ui().theme === theme,
    })),

    { id: 'db.zoomIn', category: cat.view, run: () => void window.api.app.zoom({ action: 'in' }) },
    { id: 'db.zoomOut', category: cat.view, run: () => void window.api.app.zoom({ action: 'out' }) },
    { id: 'db.zoomReset', category: cat.view, run: () => void window.api.app.zoom({ action: 'reset' }) },

    ...(['undo', 'redo', 'cut', 'copy', 'paste'] as const).map((action): Command => ({
      id: `db.edit.${action}`,
      category: cat.edit,
      run: () => void window.api.app.edit({ action }),
    })),

    { id: 'db.closeTab', category: cat.tabs, enabled: hasTabs, run: () => void closeActiveTab() },

    // Archivos (specs/11)
    { id: 'db.newScript', category: cat.file, run: () => newScript() },
    {
      id: 'db.save',
      category: cat.file,
      enabled: hasScript,
      run: async () => {
        const id = activeScript();
        if (id) await saveDocument(id);
      },
    },
    { id: 'db.saveAll', category: cat.file, run: async () => void (await saveAll()) },
    {
      id: 'db.toggleAutoSave',
      category: cat.file,
      checked: () => settings().settings['files.autoSave'],
      run: async () => {
        const next = !settings().settings['files.autoSave'];
        if (await settings().update('files.autoSave', next)) autoSaveChanged(next);
      },
    },

    // Separador de sentencias (preferencia `sql.statementSeparator`).
    ...(['semicolon', 'blankLine'] as const).map((value): Command => ({
      id: `db.statementSeparator.${value}`,
      category: cat.query,
      checked: () => settings().settings['sql.statementSeparator'] === value,
      run: async () => void (await settings().update('sql.statementSeparator', value)),
    })),

    // Ejecución (specs/05)
    {
      id: 'db.executeStatement',
      category: cat.query,
      enabled: hasScript,
      run: () => executeFromEditor('statement'),
    },
    {
      id: 'db.executeScript',
      category: cat.query,
      enabled: hasScript,
      run: () => executeFromEditor('script'),
    },
    {
      id: 'db.executeSelection',
      category: cat.query,
      enabled: hasSelection,
      run: () => executeFromEditor('script'),
    },
    {
      id: 'db.executeInNewTab',
      category: cat.query,
      enabled: hasScript,
      run: () => executeFromEditor('statement', { newResultTab: true }),
    },
    {
      id: 'db.cancel',
      category: cat.query,
      enabled: () => isRunning(activeScript()),
      run: () => cancelExecution(),
    },
    {
      id: 'db.changeConnection',
      category: cat.query,
      enabled: hasScript,
      run: () => {
        const id = activeScript();
        if (id) pickConnection(id);
      },
    },
    {
      id: 'db.changeSchema',
      category: cat.query,
      enabled: () => hasScript() && !!wb().tabs.find((t) => t.id === activeScript())?.connectionId,
      run: async () => {
        const id = activeScript();
        if (id) await pickDatabaseOrSchema(id);
      },
    },
    {
      id: 'db.reopenClosedTab',
      category: cat.tabs,
      enabled: () => wb().closed.length > 0,
      run: () => wb().reopenClosed(),
    },
    { id: 'db.nextTab', category: cat.tabs, enabled: hasTabs, run: () => wb().activateRelative(1) },
    { id: 'db.previousTab', category: cat.tabs, enabled: hasTabs, run: () => wb().activateRelative(-1) },
    ...Array.from({ length: 9 }, (_, i): Command => ({
      id: `db.openTab${i + 1}`,
      category: cat.tabs,
      hidden: true,
      enabled: () => wb().tabs.length > i,
      run: () => wb().activateIndex(i),
    })),

    { id: 'db.newConnection', category: cat.file, run: () => newConnection() },
    { id: 'db.help.keybindings', category: cat.help, run: () => overlay().openDialog({ id: 'keybindings' }) },
    { id: 'db.help.about', category: cat.help, run: () => overlay().openDialog({ id: 'about' }) },
    {
      id: 'db.window.quit',
      category: cat.file,
      run: () => void window.api.app.windowControl({ action: 'close' }),
    },
  ];

  return commands.registerMany(list);
}

/** Aviso para acciones visibles en la maqueta que llegan en hitos posteriores. */
export function notAvailable(what: string): void {
  showToast('info', es.toasts.notAvailable(what));
}
