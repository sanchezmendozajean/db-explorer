import type { KeybindingRule } from './keybindings';

/**
 * Atajos por defecto. Fuente de verdad: tabla "Propios de la app" de specs/05.
 * Incluye comandos de hitos posteriores: mientras no estén registrados, sus
 * atajos no consumen la tecla (y los menús los muestran deshabilitados).
 */
export const DEFAULT_KEYBINDINGS: readonly KeybindingRule[] = [
  // Ejecución
  { key: 'ctrl+enter', command: 'db.executeStatement', when: 'editorTextFocus' },
  { key: 'alt+x', command: 'db.executeScript' },
  { key: 'f5', command: 'db.executeScript', when: '!treeFocus' },
  { key: 'ctrl+alt+shift+enter', command: 'db.executeInNewTab' },
  { key: 'ctrl+shift+q', command: 'db.cancel' },
  { key: 'alt+pause', command: 'db.cancel' },
  { key: 'ctrl+alt+e', command: 'db.explainPlan' },
  { key: 'ctrl+alt+shift+e', command: 'db.explainAnalyze' },
  { key: 'shift+alt+f', command: 'db.formatSql' },
  { key: 'f12', command: 'db.goToDefinition', when: 'editorTextFocus' },
  { key: 'ctrl+alt+c', command: 'db.commit' },
  { key: 'ctrl+alt+r', command: 'db.rollback' },

  // Archivos
  { key: 'ctrl+s', command: 'db.save' },
  { key: 'ctrl+shift+s', command: 'db.saveAs' },
  { key: 'ctrl+k s', command: 'db.saveAll' },
  { key: 'ctrl+n', command: 'db.newScript' },
  { key: 'ctrl+o', command: 'db.openFile' },

  // Vista Archivos (specs/07): solo con el árbol enfocado y fuera del campo de nombre.
  { key: 'f2', command: 'db.files.rename', when: 'filesFocus && !inputFocus' },
  { key: 'delete', command: 'db.files.delete', when: 'filesFocus && !inputFocus' },
  { key: 'ctrl+c', command: 'db.files.copy', when: 'filesFocus && !inputFocus' },
  { key: 'ctrl+x', command: 'db.files.cut', when: 'filesFocus && !inputFocus' },
  { key: 'ctrl+v', command: 'db.files.paste', when: 'filesFocus && !inputFocus' },
  { key: 'shift+alt+c', command: 'db.files.copyPath', when: 'filesFocus && !inputFocus' },
  { key: 'ctrl+k ctrl+shift+c', command: 'db.files.copyRelativePath', when: 'filesFocus && !inputFocus' },

  // Edición en la grilla de resultados (specs/06): solo con la grilla enfocada y sin el editor de celda abierto.
  { key: 'ctrl+s', command: 'db.results.save', when: 'gridFocus' },
  { key: 'ctrl+z', command: 'db.results.undo', when: 'gridFocus && !inputFocus' },
  { key: 'delete', command: 'db.results.clearCells', when: 'gridFocus && !inputFocus' },
  { key: 'shift+delete', command: 'db.results.setNull', when: 'gridFocus && !inputFocus' },
  { key: 'alt+insert', command: 'db.results.addRow', when: 'gridFocus' },
  { key: 'ctrl+delete', command: 'db.results.deleteRows', when: 'gridFocus && !inputFocus' },
  { key: 'ctrl+v', command: 'db.results.paste', when: 'gridFocus && !inputFocus' },

  // Pestañas
  { key: 'ctrl+w', command: 'db.closeTab' },
  { key: 'ctrl+f4', command: 'db.closeTab' },
  { key: 'ctrl+shift+t', command: 'db.reopenClosedTab' },
  { key: 'ctrl+tab', command: 'db.nextTab' },
  { key: 'ctrl+pagedown', command: 'db.nextTab' },
  { key: 'ctrl+shift+tab', command: 'db.previousTab' },
  { key: 'ctrl+pageup', command: 'db.previousTab' },
  ...Array.from({ length: 9 }, (_, i) => ({ key: `alt+${i + 1}`, command: `db.openTab${i + 1}` })),

  // Paletas y navegación
  { key: 'ctrl+shift+p', command: 'db.showCommands' },
  { key: 'f1', command: 'db.showCommands' },
  { key: 'ctrl+p', command: 'db.quickOpen' },
  { key: 'ctrl+9', command: 'db.changeConnection' },
  { key: 'ctrl+0', command: 'db.changeSchema' },

  // Distribución
  { key: 'ctrl+b', command: 'db.toggleSidebar' },
  { key: 'ctrl+j', command: 'db.togglePanel' },
  { key: 'ctrl+shift+j', command: 'db.maximizePanel' },
  { key: 'ctrl+1', command: 'db.focusEditor' },
  { key: 'ctrl+2', command: 'db.focusPanel' },
  { key: 'ctrl+shift+d', command: 'db.view.connections' },
  { key: 'ctrl+shift+e', command: 'db.view.files' },
  { key: 'ctrl+,', command: 'db.preferences' },
  { key: 'ctrl+k ctrl+s', command: 'db.keybindings.open' },

  // Zoom (con alternativas para teclados donde "=" requiere Shift, como el español)
  { key: 'ctrl+=', command: 'db.zoomIn' },
  { key: 'ctrl+shift+=', command: 'db.zoomIn' },
  { key: 'ctrl++', command: 'db.zoomIn' },
  { key: 'ctrl+shift++', command: 'db.zoomIn' },
  { key: 'ctrl+numpad_add', command: 'db.zoomIn' },
  { key: 'ctrl+-', command: 'db.zoomOut' },
  { key: 'ctrl+numpad_subtract', command: 'db.zoomOut' },
  { key: 'ctrl+numpad0', command: 'db.zoomReset' },

  // Editor (Monaco los resuelve por sí mismo; aquí solo se muestran en menús)
  { key: 'ctrl+f', command: 'editor.action.find', when: 'editorTextFocus' },
  { key: 'ctrl+h', command: 'editor.action.replace', when: 'editorTextFocus' },
  { key: 'ctrl+/', command: 'editor.action.commentLine', when: 'editorTextFocus' },
];
