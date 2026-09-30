import { Codicon } from '../../components/Codicon';
import { keybindingLabel } from '../../commands/service';
import { es } from '../../i18n/es';

/** Estado vacío del grupo de editores (specs/04 §16), como la marca de agua de VS Code. */
export function Watermark(): React.JSX.Element {
  const w = es.editor.watermark;
  const entries: [string, string | undefined][] = [
    [w.newScript, keybindingLabel('db.newScript')],
    [w.findObject, keybindingLabel('db.quickOpen')],
    [w.commands, keybindingLabel('db.showCommands')],
    [w.newConnection, undefined],
    [w.changeWorkspace, undefined],
  ];
  return (
    <div className="watermark" data-focus-context="editorFocus" tabIndex={-1} data-testid="watermark">
      <Codicon name="database" size={128} className="watermark-logo" />
      <dl className="watermark-list">
        {entries.map(([label, key]) => (
          <div key={label} className="watermark-entry">
            <dt>{label}</dt>
            <dd>{key ? key.split(' ').map((k) => <kbd key={k}>{k}</kbd>) : null}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
