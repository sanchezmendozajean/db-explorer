import type { MenuEntry } from '../components/menu-types';
import { SEPARATOR } from '../components/menu-types';
import { commands, keybindingLabel } from '../commands/service';
import { commandTitle, es } from '../i18n/es';
import { useWorkspaceStore } from '../stores/workspace-store';
import { switchWorkspace } from '../features/files/workspace-actions';

/**
 * Entrada de menú a partir de un comando: título, atajo y estado salen del
 * registro. Si el comando aún no existe (hito posterior) queda deshabilitada.
 */
export function commandEntry(id: string, label?: string): MenuEntry {
  const command = commands.get(id);
  const disabled = !commands.isEnabled(id);
  return {
    type: 'item',
    id,
    label: label ?? command?.title ?? commandTitle(id),
    keybinding: keybindingLabel(id),
    disabled,
    title: disabled ? command?.disabledReason?.() : undefined,
    checked: command?.checked?.(),
    run: () => void commands.execute(id),
  };
}

/** Archivo › Abrir espacio reciente (specs/07: hasta 10), sin el actual. */
function recentWorkspacesMenu(): MenuEntry {
  const { recent, path } = useWorkspaceStore.getState();
  const others = recent.filter((p) => p.toLowerCase() !== path.toLowerCase());
  const entries: MenuEntry[] = others.length
    ? others.map((p) => ({ type: 'item', id: p, label: p, run: () => void switchWorkspace(p) }))
    : [{ type: 'item', id: 'no-recent', label: es.menu.noRecent, disabled: true, run: () => undefined }];
  entries.push(SEPARATOR, commandEntry('db.workspace.reset'));
  return { type: 'submenu', id: 'recent', label: es.menu.recentWorkspaces, entries };
}

export interface TopMenu {
  id: string;
  label: string;
  entries: () => MenuEntry[];
}

/** Menús de la title bar (specs/04 §4). */
export const TITLE_BAR_MENUS: TopMenu[] = [
  {
    id: 'file',
    label: es.menu.file,
    entries: () => [
      commandEntry('db.newScript'),
      commandEntry('db.openFile'),
      commandEntry('db.workspace.change'),
      recentWorkspacesMenu(),
      SEPARATOR,
      commandEntry('db.save'),
      commandEntry('db.saveAs'),
      commandEntry('db.saveAll'),
      commandEntry('db.toggleAutoSave'),
      SEPARATOR,
      commandEntry('db.newConnection'),
      SEPARATOR,
      commandEntry('db.preferences'),
      commandEntry('db.keybindings.open'),
      SEPARATOR,
      commandEntry('db.window.quit'),
    ],
  },
  {
    id: 'edit',
    label: es.menu.edit,
    entries: () => [
      commandEntry('db.edit.undo'),
      commandEntry('db.edit.redo'),
      SEPARATOR,
      commandEntry('db.edit.cut'),
      commandEntry('db.edit.copy'),
      commandEntry('db.edit.paste'),
      SEPARATOR,
      commandEntry('editor.action.find'),
      commandEntry('editor.action.replace'),
      SEPARATOR,
      commandEntry('db.formatSql'),
      commandEntry('editor.action.commentLine'),
    ],
  },
  {
    id: 'view',
    label: es.menu.view,
    entries: () => [
      commandEntry('db.showCommands'),
      SEPARATOR,
      commandEntry('db.view.connections'),
      commandEntry('db.view.files'),
      commandEntry('db.view.history'),
      SEPARATOR,
      commandEntry('db.toggleSidebar'),
      commandEntry('db.togglePanel'),
      commandEntry('db.maximizePanel'),
      SEPARATOR,
      { type: 'submenu', id: 'theme', label: es.menu.theme, entries: themeEntries() },
      {
        type: 'submenu',
        id: 'zoom',
        label: es.menu.zoom,
        entries: [commandEntry('db.zoomIn'), commandEntry('db.zoomOut'), commandEntry('db.zoomReset')],
      },
    ],
  },
  {
    id: 'query',
    label: es.menu.query,
    entries: () => [
      commandEntry('db.executeStatement'),
      commandEntry('db.executeScript'),
      commandEntry('db.executeSelection'),
      commandEntry('db.cancel'),
      statementSeparatorMenu(),
      SEPARATOR,
      commandEntry('db.commit'),
      commandEntry('db.rollback'),
      commandEntry('db.toggleAutoCommit'),
      SEPARATOR,
      commandEntry('db.explainPlan'),
      commandEntry('db.explainAnalyze'),
      commandEntry('db.changeConnection'),
      commandEntry('db.changeSchema'),
    ],
  },
  {
    id: 'help',
    label: es.menu.help,
    entries: () => [commandEntry('db.help.keybindings'), SEPARATOR, commandEntry('db.help.about')],
  },
];

/** Submenú "Separador de sentencias" (menú Consulta y menú contextual del editor). */
export function statementSeparatorMenu(): MenuEntry {
  return {
    type: 'submenu',
    id: 'separator',
    label: es.menu.statementSeparator,
    entries: [
      commandEntry('db.statementSeparator.blankLine', es.menu.separatorBlankLine),
      commandEntry('db.statementSeparator.semicolon', es.menu.separatorSemicolon),
    ],
  };
}

export function themeEntries(): MenuEntry[] {
  return [commandEntry('db.theme.dark'), commandEntry('db.theme.light'), commandEntry('db.theme.system')];
}
