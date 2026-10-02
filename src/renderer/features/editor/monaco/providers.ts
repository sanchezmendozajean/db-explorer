import type * as MonacoApi from 'monaco-editor/editor/editor.api';
import type { Engine } from '@shared/connection';
import { es } from '../../../i18n/es';
import { connectionById } from '../../../stores/connections-store';
import { setting, useSettingsStore } from '../../../stores/settings-store';
import { showToast } from '../../../stores/toast-store';
import { useWorkbenchStore } from '../../../stores/workbench-store';
import { allDocuments } from '../documents';
import { formatFragment, formatScript } from '../sql-format';
import { completionItems, hoverMarkdown, resolveItem } from '../sql-intellisense';
import type { DbCompletionItem } from '../sql-intellisense';
import type { Monaco } from './loader';

/** Lenguajes de Monaco de los scripts SQL (según el motor de la pestaña). */
export const SQL_LANGUAGES = ['sql', 'pgsql', 'mysql'];

/** Pestaña y motor del documento de un modelo de Monaco. */
export function modelContext(model: MonacoApi.editor.ITextModel): {
  tabId?: string;
  connectionId?: string;
  engine?: Engine;
  database?: string;
  schema?: string;
} {
  const doc = allDocuments().find((d) => d.model === model);
  const tab = doc ? useWorkbenchStore.getState().tabs.find((t) => t.id === doc.tabId) : undefined;
  return {
    tabId: tab?.id,
    connectionId: tab?.connectionId,
    engine: connectionById(tab?.connectionId)?.engine,
    database: tab?.database,
    schema: tab?.schema,
  };
}

function tabWidth(): number {
  const size = useSettingsStore.getState().settings.editor['tabSize'];
  return typeof size === 'number' && size > 0 ? size : 4;
}

let registered = false;

/**
 * Proveedores de Monaco para SQL (specs/05): autocompletado, hover y
 * formateo con `sql-formatter` (Shift+Alt+F, documento o selección). Se
 * registran una vez.
 */
export function registerSqlProviders(monaco: Monaco): void {
  if (registered) return;
  registered = true;
  for (const language of SQL_LANGUAGES) {
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['.', '"', '`', '['],
      provideCompletionItems: async (model, position) => ({
        suggestions: await completionItems(monaco, model, position, modelContext(model).tabId),
      }),
      resolveCompletionItem: (item) => resolveItem(item as DbCompletionItem),
    });
    monaco.languages.registerHoverProvider(language, {
      provideHover: async (model, position) => {
        const value = await hoverMarkdown(model, position, modelContext(model).tabId);
        return value ? { contents: [{ value }] } : null;
      },
    });
    monaco.languages.registerDocumentFormattingEditProvider(language, {
      displayName: 'sql-formatter',
      provideDocumentFormattingEdits: (model) => {
        const { engine } = modelContext(model);
        const result = formatScript(model.getValue(), engine, {
          tabWidth: tabWidth(),
          split: { blankLineSeparator: setting('sql.statementSeparator') === 'blankLine' },
        });
        if (result.failed > 0) showToast('warning', es.editor.formatPartial(result.failed));
        return [{ range: model.getFullModelRange(), text: result.text }];
      },
    });
    monaco.languages.registerDocumentRangeFormattingEditProvider(language, {
      displayName: 'sql-formatter',
      provideDocumentRangeFormattingEdits: (model, range) => {
        try {
          return [
            {
              range,
              text: formatFragment(model.getValueInRange(range), modelContext(model).engine, tabWidth()),
            },
          ];
        } catch (err) {
          showToast('error', es.editor.formatFailed(err instanceof Error ? err.message : String(err)));
          return [];
        }
      },
    });
  }
}
