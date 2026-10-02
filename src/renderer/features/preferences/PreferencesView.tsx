import { useState } from 'react';
import { Button } from '../../components/Button';
import { Checkbox, TextInput } from '../../components/Inputs';
import { es } from '../../i18n/es';
import { useSettingsStore } from '../../stores/settings-store';
import { commands } from '../../commands/service';
import { useWorkspaceStore } from '../../stores/workspace-store';
import { autoSaveChanged } from '../editor/documents';
import { changeWorkspace, resetWorkspace, revealWorkspace } from '../files/workspace-actions';

/** Un ajuste: título en negrita, descripción y control (specs/04 §15). */
function Setting({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="pref-setting">
      <div className="pref-title">{title}</div>
      {description && <div className="pref-description">{description}</div>}
      <div className="pref-control">{children}</div>
    </div>
  );
}

/**
 * Preferencias (specs/04 §15). En M5 solo el grupo Archivos (specs/11 §5); la
 * UI completa con buscador y el resto de los grupos llega en M9.
 */
export function PreferencesView(): React.JSX.Element {
  const p = es.preferences;
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const workspacePath = useWorkspaceStore((s) => s.path);
  const autoSave = settings['files.autoSave'];
  const delaySeconds = Math.round(settings['files.autoSaveDelay'] / 1000);
  // Texto mientras se escribe; sin edición en curso se muestra el valor guardado.
  const [draft, setDraft] = useState<string | null>(null);
  const delay = draft ?? String(delaySeconds);

  const commitDelay = (): void => {
    const n = Number(delay);
    if (Number.isInteger(n) && n >= 1 && n <= 60) {
      void update('files.autoSaveDelay', n * 1000).then((ok) => ok && autoSaveChanged(autoSave));
    }
    setDraft(null);
  };

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
      <section className="pref-group" aria-labelledby="pref-files">
        <h2 id="pref-files" className="pref-group-title">
          {p.files}
        </h2>

        <Setting title={p.workspace} description={p.workspaceDescription}>
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
        </Setting>

        <Setting title={p.autoSave}>
          <Checkbox
            label={p.autoSaveLabel}
            checked={autoSave}
            onChange={(e) => {
              const next = e.target.checked;
              void update('files.autoSave', next).then((ok) => ok && autoSaveChanged(next));
            }}
          />
        </Setting>

        <Setting title={p.delay} description={p.delayDescription}>
          <TextInput
            type="number"
            min={1}
            max={60}
            value={delay}
            disabled={!autoSave}
            aria-label={p.delay}
            className="pref-number"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDelay}
            onKeyDown={(e) => e.key === 'Enter' && commitDelay()}
          />
        </Setting>

        <Setting title={p.emptyScripts}>
          <Checkbox
            label={p.emptyScriptsLabel}
            checked={settings['scripts.deleteEmptyOnClose']}
            onChange={(e) => void update('scripts.deleteEmptyOnClose', e.target.checked)}
          />
        </Setting>

        <Setting title={p.newScripts} description={p.newScriptsDescription}>
          <span className="pref-value">{p.newScriptsValue}</span>
        </Setting>

        <Setting title={p.confirmDrag}>
          <Checkbox
            label={p.confirmDragLabel}
            checked={settings['files.confirmDragAndDrop']}
            onChange={(e) => void update('files.confirmDragAndDrop', e.target.checked)}
          />
        </Setting>

        <Setting title={p.autoReveal}>
          <Checkbox
            label={p.autoRevealLabel}
            checked={settings['files.autoReveal']}
            onChange={(e) => void update('files.autoReveal', e.target.checked)}
          />
        </Setting>
      </section>
    </div>
  );
}
