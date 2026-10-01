import type { MenuEntry } from '../../components/menu-types';
import { SEPARATOR } from '../../components/menu-types';
import { commandEntry, statementSeparatorMenu } from '../../app/menus';
import { es } from '../../i18n/es';
import type { CodeEditor } from './editor-instance';

/** Cortar/copiar/pegar con el foco devuelto al editor (el portapapeles lo maneja Electron). */
function clipboardEntry(
  editor: CodeEditor,
  action: 'cut' | 'copy' | 'paste',
  label: string,
  key: string,
): MenuEntry {
  return {
    type: 'item',
    id: action,
    label,
    keybinding: key,
    run: () => {
      editor.focus();
      void window.api.app.edit({ action });
    },
  };
}

/**
 * Menú contextual del editor SQL. Reemplaza al de Monaco para usar el estilo
 * de la app (borde y sombra) y poder mostrar submenús y marcas, como el
 * separador de sentencias.
 */
export function editorContextMenu(editor: CodeEditor): MenuEntry[] {
  const e = es.editor.contextMenu;
  return [
    {
      type: 'item',
      id: 'changeAll',
      label: e.changeAll,
      keybinding: 'Ctrl+F2',
      run: () => {
        editor.focus();
        void editor.getAction('editor.action.changeAll')?.run();
      },
    },
    SEPARATOR,
    commandEntry('db.executeStatement'),
    commandEntry('db.executeScript'),
    commandEntry('db.executeSelection'),
    statementSeparatorMenu(),
    SEPARATOR,
    commandEntry('db.newScript'),
    SEPARATOR,
    clipboardEntry(editor, 'cut', es.commands['db.edit.cut'] as string, 'Ctrl+X'),
    clipboardEntry(editor, 'copy', es.commands['db.edit.copy'] as string, 'Ctrl+C'),
    clipboardEntry(editor, 'paste', es.commands['db.edit.paste'] as string, 'Ctrl+V'),
    SEPARATOR,
    commandEntry('db.showCommands'),
  ];
}
