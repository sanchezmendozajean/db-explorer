import { useState } from 'react';
import { DEFAULT_SETTINGS } from '@shared/settings';
import type { SettingKey } from '@shared/settings';
import type { ThemePreference } from '@shared/ui-state';
import { Button } from '../../components/Button';
import { Codicon } from '../../components/Codicon';
import { Checkbox, Select, TextInput } from '../../components/Inputs';
import { es } from '../../i18n/es';
import { commands } from '../../commands/service';
import { useConnectionsStore } from '../../stores/connections-store';
import { useSettingsStore } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { newConnection } from '../connections/actions';
import { autoSaveChanged } from '../editor/documents';
import { changeWorkspace, resetWorkspace, revealWorkspace } from '../files/workspace-actions';
import { formatEntries } from './format-preferences';
import type { PrefEntry } from './pref-controls';
import { CommitInput } from './pref-controls';
import { intInRange, matchesSearch } from './pref-search';

type GroupId = keyof typeof es.preferences.groups;

const GROUP_ICONS: Record<GroupId, string> = {
  editor: 'edit',
  files: 'files',
  results: 'table',
  formats: 'symbol-ruler',
  connections: 'database',
  appearance: 'symbol-color',
};

/** Opciones de Monaco que se editan desde la UI y su valor por defecto (specs/05). */
const EDITOR_DEFAULTS = { fontSize: 13, tabSize: 4, wordWrap: 'off', lineNumbers: 'on' } as const;

/**
 * Preferencias (specs/04 §15): buscador y lista agrupada (Editor, Archivos,
 * Resultados, Formatos de datos, Conexiones, Apariencia), con un índice para
 * saltar a cada grupo. Cada cambio se guarda en settings.json al momento.
 */
export function PreferencesView(): React.JSX.Element {
  const p = es.preferences;
  const settings = useSettingsStore((s) => s.settings);
  const { update, reset, updateEditor } = useSettingsStore.getState();
  const workspacePath = useWorkspaceStore((s) => s.path);
  const connections = useConnectionsStore((s) => s.connections);
  const theme = useUiStore((s) => s.theme);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<string | null>(null);
  const formatScope = scope && connections.some((c) => c.id === scope) ? scope : null;

  const modified = (key: SettingKey): boolean =>
    JSON.stringify(settings[key]) !== JSON.stringify(DEFAULT_SETTINGS[key]);
  /** Entrada de una clave de settings con "Restablecer". */
  const keyed = (key: SettingKey, entry: Omit<PrefEntry, 'modified' | 'onReset'>): PrefEntry => ({
    ...entry,
    modified: modified(key),
    onReset: () => void reset(key),
  });
  const editorValue = <K extends keyof typeof EDITOR_DEFAULTS>(name: K): unknown =>
    settings.editor[name] ?? EDITOR_DEFAULTS[name];
  const editorEntry = (
    name: keyof typeof EDITOR_DEFAULTS,
    entry: Omit<PrefEntry, 'modified' | 'onReset'>,
  ): PrefEntry => ({
    ...entry,
    modified: settings.editor[name] !== undefined,
    onReset: () => void updateEditor(name, undefined),
  });
  const autoSave = settings['files.autoSave'];

  const groups: { id: GroupId; entries: PrefEntry[] }[] = [
    {
      id: 'editor',
      entries: [
        editorEntry('fontSize', {
          id: 'editor-font-size',
          icon: 'text-size',
          title: p.editor.fontSize,
          description: p.editor.fontSizeDescription,
          render: () => (
            <CommitInput
              type="number"
              min={6}
              max={40}
              value={String(editorValue('fontSize'))}
              ariaLabel={p.editor.fontSize}
              className="pref-number"
              onCommit={(text) => {
                const n = intInRange(text, 6, 40);
                if (n === null) return false;
                void updateEditor('fontSize', n);
              }}
            />
          ),
        }),
        editorEntry('tabSize', {
          id: 'editor-tab-size',
          icon: 'indent',
          title: p.editor.tabSize,
          description: p.editor.tabSizeDescription,
          render: () => (
            <CommitInput
              type="number"
              min={1}
              max={16}
              value={String(editorValue('tabSize'))}
              ariaLabel={p.editor.tabSize}
              className="pref-number"
              onCommit={(text) => {
                const n = intInRange(text, 1, 16);
                if (n === null) return false;
                void updateEditor('tabSize', n);
              }}
            />
          ),
        }),
        editorEntry('wordWrap', {
          id: 'editor-word-wrap',
          icon: 'word-wrap',
          title: p.editor.wordWrap,
          render: () => (
            <Checkbox
              label={p.editor.wordWrapLabel}
              checked={editorValue('wordWrap') === 'on'}
              onChange={(e) => void updateEditor('wordWrap', e.target.checked ? 'on' : 'off')}
            />
          ),
        }),
        editorEntry('lineNumbers', {
          id: 'editor-line-numbers',
          icon: 'list-ordered',
          title: p.editor.lineNumbers,
          render: () => (
            <Checkbox
              label={p.editor.lineNumbersLabel}
              checked={editorValue('lineNumbers') !== 'off'}
              onChange={(e) => void updateEditor('lineNumbers', e.target.checked ? 'on' : 'off')}
            />
          ),
        }),
        keyed('sql.statementSeparator', {
          id: 'editor-separator',
          icon: 'list-selection',
          title: p.editor.separator,
          description: p.editor.separatorDescription,
          render: () => (
            <Select
              aria-label={p.editor.separator}
              value={settings['sql.statementSeparator']}
              onChange={(e) =>
                void update('sql.statementSeparator', e.target.value as 'semicolon' | 'blankLine')
              }
              options={[
                { value: 'semicolon', label: p.editor.separators.semicolon },
                { value: 'blankLine', label: p.editor.separators.blankLine },
              ]}
            />
          ),
        }),
      ],
    },
    {
      id: 'files',
      entries: [
        {
          id: 'files-workspace',
          icon: 'folder-opened',
          title: p.workspace,
          description: p.workspaceDescription,
          modified: settings['workspace.path'] !== null,
          render: () => (
            <>
              <TextInput value={workspacePath} readOnly aria-label={p.workspace} className="pref-path" />
              <div className="pref-buttons">
                <Button variant="secondary" onClick={() => void changeWorkspace()}>
                  {p.change}
                </Button>
                <Button variant="secondary" onClick={() => void revealWorkspace()}>
                  {p.openInExplorer}
                </Button>
                <Button
                  variant="secondary"
                  disabled={settings['workspace.path'] === null}
                  onClick={() => void resetWorkspace()}
                >
                  {p.reset}
                </Button>
              </div>
            </>
          ),
        },
        {
          id: 'files-autosave',
          icon: 'save',
          title: p.autoSave,
          modified: modified('files.autoSave'),
          onReset: () => void reset('files.autoSave').then((ok) => ok && autoSaveChanged(true)),
          render: () => (
            <Checkbox
              label={p.autoSaveLabel}
              checked={autoSave}
              onChange={(e) => {
                const next = e.target.checked;
                void update('files.autoSave', next).then((ok) => ok && autoSaveChanged(next));
              }}
            />
          ),
        },
        {
          id: 'files-autosave-delay',
          icon: 'watch',
          title: p.delay,
          description: p.delayDescription,
          modified: modified('files.autoSaveDelay'),
          onReset: () =>
            void reset('files.autoSaveDelay').then(
              (ok) => ok && autoSaveChanged(useSettingsStore.getState().settings['files.autoSave']),
            ),
          render: () => (
            <CommitInput
              type="number"
              min={1}
              max={60}
              value={String(Math.round(settings['files.autoSaveDelay'] / 1000))}
              disabled={!autoSave}
              ariaLabel={p.delay}
              className="pref-number"
              onCommit={(text) => {
                const n = intInRange(text, 1, 60);
                if (n === null) return false;
                void update('files.autoSaveDelay', n * 1000).then((ok) => ok && autoSaveChanged(autoSave));
              }}
            />
          ),
        },
        keyed('scripts.deleteEmptyOnClose', {
          id: 'files-empty-scripts',
          icon: 'trash',
          title: p.emptyScripts,
          render: () => (
            <Checkbox
              label={p.emptyScriptsLabel}
              checked={settings['scripts.deleteEmptyOnClose']}
              onChange={(e) => void update('scripts.deleteEmptyOnClose', e.target.checked)}
            />
          ),
        }),
        {
          id: 'files-new-scripts',
          icon: 'new-file',
          title: p.newScripts,
          description: p.newScriptsDescription,
          render: () => <span className="pref-value">{p.newScriptsValue}</span>,
        },
        keyed('files.confirmDragAndDrop', {
          id: 'files-confirm-drag',
          icon: 'arrow-swap',
          title: p.confirmDrag,
          render: () => (
            <Checkbox
              label={p.confirmDragLabel}
              checked={settings['files.confirmDragAndDrop']}
              onChange={(e) => void update('files.confirmDragAndDrop', e.target.checked)}
            />
          ),
        }),
        keyed('files.autoReveal', {
          id: 'files-auto-reveal',
          icon: 'target',
          title: p.autoReveal,
          render: () => (
            <Checkbox
              label={p.autoRevealLabel}
              checked={settings['files.autoReveal']}
              onChange={(e) => void update('files.autoReveal', e.target.checked)}
            />
          ),
        }),
      ],
    },
    {
      id: 'results',
      entries: [
        keyed('results.maxRows', {
          id: 'results-max-rows',
          icon: 'list-flat',
          title: p.results.maxRows,
          description: p.results.maxRowsDescription,
          render: () => (
            <CommitInput
              type="number"
              min={1}
              max={10_000_000}
              value={settings['results.maxRows']}
              ariaLabel={p.results.maxRows}
              className="pref-number"
              onCommit={(text) => {
                const n = intInRange(text, 1, 10_000_000);
                if (n === null) return false;
                void update('results.maxRows', n);
              }}
            />
          ),
        }),
        keyed('results.alternateRows', {
          id: 'results-alternate',
          icon: 'paintcan',
          title: p.results.alternateRows,
          render: () => (
            <Checkbox
              label={p.results.alternateRowsLabel}
              checked={settings['results.alternateRows']}
              onChange={(e) => void update('results.alternateRows', e.target.checked)}
            />
          ),
        }),
        keyed('results.fontSize', {
          id: 'results-font-size',
          icon: 'text-size',
          title: p.results.fontSize,
          render: () => (
            <CommitInput
              type="number"
              min={8}
              max={32}
              value={settings['results.fontSize']}
              ariaLabel={p.results.fontSize}
              className="pref-number"
              onCommit={(text) => {
                const n = intInRange(text, 8, 32);
                if (n === null) return false;
                void update('results.fontSize', n);
              }}
            />
          ),
        }),
        keyed('results.copy.nullAs', {
          id: 'results-copy-null',
          icon: 'copy',
          title: p.results.copyNull,
          description: p.results.copyNullDescription,
          render: () => (
            <CommitInput
              value={settings['results.copy.nullAs']}
              ariaLabel={p.results.copyNull}
              className="pref-pattern"
              onCommit={(text) => void update('results.copy.nullAs', text)}
            />
          ),
        }),
        keyed('history.enabled', {
          id: 'results-history',
          icon: 'history',
          title: p.results.history,
          render: () => (
            <Checkbox
              label={p.results.historyLabel}
              checked={settings['history.enabled']}
              onChange={(e) => void update('history.enabled', e.target.checked)}
            />
          ),
        }),
        keyed('history.maxEntries', {
          id: 'results-history-max',
          icon: 'archive',
          title: p.results.historyMax,
          render: () => (
            <CommitInput
              type="number"
              min={100}
              max={1_000_000}
              value={settings['history.maxEntries']}
              disabled={!settings['history.enabled']}
              ariaLabel={p.results.historyMax}
              className="pref-number"
              onCommit={(text) => {
                const n = intInRange(text, 100, 1_000_000);
                if (n === null) return false;
                void update('history.maxEntries', n);
              }}
            />
          ),
        }),
      ],
    },
    { id: 'formats', entries: formatEntries(settings, formatScope, setScope, connections) },
    {
      id: 'connections',
      entries: [
        {
          id: 'connections-info',
          icon: 'plug',
          title: p.groups.connections,
          description: p.connections.info,
          render: () => (
            <Button variant="secondary" icon="add" onClick={() => newConnection()}>
              {p.connections.newConnection}
            </Button>
          ),
        },
      ],
    },
    {
      id: 'appearance',
      entries: [
        {
          id: 'appearance-theme',
          icon: 'color-mode',
          title: p.appearance.theme,
          modified: theme !== 'system',
          onReset: () => useUiStore.getState().setTheme('system'),
          render: () => (
            <Select
              aria-label={p.appearance.theme}
              value={theme}
              onChange={(e) => useUiStore.getState().setTheme(e.target.value as ThemePreference)}
              options={(['dark', 'light', 'system'] as const).map((value) => ({
                value,
                label: p.appearance.themes[value],
              }))}
            />
          ),
        },
        {
          id: 'appearance-zoom',
          icon: 'zoom-in',
          title: p.appearance.zoom,
          description: p.appearance.zoomDescription,
          render: () => (
            <div className="pref-buttons">
              <Button variant="secondary" icon="zoom-out" onClick={() => void commands.execute('db.zoomOut')}>
                {p.appearance.zoomOut}
              </Button>
              <Button variant="secondary" icon="zoom-in" onClick={() => void commands.execute('db.zoomIn')}>
                {p.appearance.zoomIn}
              </Button>
              <Button variant="secondary" onClick={() => void commands.execute('db.zoomReset')}>
                {p.appearance.zoomReset}
              </Button>
            </div>
          ),
        },
      ],
    },
  ];

  const visible = groups
    .map((g) => ({
      ...g,
      entries: g.entries.filter((e) =>
        matchesSearch(query, [e.title, e.description, e.keywords, p.groups[g.id]]),
      ),
    }))
    .filter((g) => g.entries.length > 0);

  return (
    <div className="preferences" data-testid="preferences">
      <div className="pref-header">
        <h1 className="pref-heading">{p.title}</h1>
        <Button
          variant="secondary"
          icon="go-to-file"
          onClick={() => void commands.execute('db.preferences.openJson')}
        >
          {p.openJson}
        </Button>
      </div>
      <TextInput
        icon="search"
        className="pref-search"
        placeholder={p.search}
        aria-label={p.search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
      />
      <div className="pref-body">
        <nav className="pref-toc" aria-label={p.groupsLabel}>
          {visible.map((g) => (
            <button
              key={g.id}
              type="button"
              className="pref-toc-item"
              onClick={() => document.getElementById(`pref-${g.id}`)?.scrollIntoView({ block: 'start' })}
            >
              <Codicon name={GROUP_ICONS[g.id]} />
              {p.groups[g.id]}
            </button>
          ))}
        </nav>
        <div className="pref-groups">
          {visible.length === 0 && <p className="pref-description">{p.noResults}</p>}
          {visible.map((g) => (
            <section key={g.id} className="pref-group" aria-labelledby={`pref-${g.id}`}>
              <h2 id={`pref-${g.id}`} className="pref-group-title">
                <Codicon name={GROUP_ICONS[g.id]} />
                {p.groups[g.id]}
              </h2>
              {g.entries.map((e) => (
                <div key={e.id} className="pref-setting" data-pref={e.id}>
                  <div className="pref-title">
                    {e.modified && <span className="pref-modified" title={p.resetSetting} />}
                    <Codicon name={e.icon} className="pref-title-icon" />
                    {e.title}
                    {e.modified && e.onReset && (
                      <button type="button" className="pref-reset" onClick={e.onReset}>
                        {p.resetSetting}
                      </button>
                    )}
                  </div>
                  {e.description && <div className="pref-description">{e.description}</div>}
                  <div className="pref-control">{e.render()}</div>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
