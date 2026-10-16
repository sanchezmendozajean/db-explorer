import { useEffect, useMemo, useState } from 'react';
import type { IpcError, PingResult } from '@shared/ipc';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { TextInput } from '../../components/Inputs';
import { commands, keybindings, useKeybindingsVersion } from '../../commands/service';
import { DEFAULT_KEYBINDINGS } from '../../commands/default-keybindings';
import { formatSequence, parseKeybinding } from '../../commands/keybindings';
import { commandTitle, es } from '../../i18n/es';
import { useOverlayStore } from '../../stores/overlay-store';
import { ConnectionDialog } from '../connections/ConnectionDialog';
import { ConfirmDialog, PasswordDialog, PromptDialog } from './SimpleDialogs';
import { ChoiceDialog, SqlPreviewDialog, WriteConfirmDialog } from './ChoiceDialogs';
import { ExportDialog } from '../results/ExportDialog';
import { CompareDialog } from '../editor/CompareDialog';
import { BackupDialog } from '../db-admin/BackupDialog';
import { ToolsDialog } from '../db-admin/ToolsDialog';

type PingState =
  { status: 'pending' } | { status: 'ok'; result: PingResult } | { status: 'error'; error: IpcError };

/** Atajo por defecto tal como se muestra (p. ej. `Ctrl+K Ctrl+S`). */
function formatKey(key: string): string {
  try {
    return formatSequence(parseKeybinding(key));
  } catch {
    return key;
  }
}

function AboutDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [ping, setPing] = useState<PingState>({ status: 'pending' });
  const a = es.dialogs.about;

  useEffect(() => {
    let alive = true;
    void window.api.app.ping({ message: 'ping' }).then((r) => {
      if (alive) setPing(r.ok ? { status: 'ok', result: r.data } : { status: 'error', error: r.error });
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Modal
      title={a.title}
      onClose={onClose}
      footer={
        <Button onClick={onClose} data-autofocus>
          {es.dialogs.ok}
        </Button>
      }
    >
      <p>{a.description}</p>
      <dl className="about-list">
        <dt>{a.version}</dt>
        <dd>{__APP_VERSION__}</dd>
        <dt>{a.dbHost}</dt>
        <dd data-testid="ping-status">
          {ping.status === 'pending' && a.dbHostPending}
          {ping.status === 'ok' && a.dbHostOk(ping.result.dbHostPid, es.units.ms(ping.result.roundTripMs))}
          {ping.status === 'error' && a.dbHostError(ping.error.message)}
        </dd>
        {ping.status === 'ok' && (
          <>
            <dt>{a.electron}</dt>
            <dd>{ping.result.versions.electron}</dd>
            <dt>{a.node}</dt>
            <dd>{ping.result.versions.node}</dd>
          </>
        )}
      </dl>
    </Modal>
  );
}

/** Lista de solo lectura; la edición con `keybindings.json` llega en M6. */
function KeybindingsDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [filter, setFilter] = useState('');
  const k = es.dialogs.keybindings;
  // Se vuelve a calcular si cambia keybindings.json con el diálogo abierto.
  const version = useKeybindingsVersion((s) => s.version);
  const rows = useMemo(() => {
    void version;
    // Los de fábrica y los que el usuario asignó a otros comandos; los quitados (`-comando`) ya no figuran.
    const defaults = new Map<string, string>();
    for (const r of DEFAULT_KEYBINDINGS) {
      if (r.command.startsWith('-')) continue;
      defaults.set(
        r.command,
        [...(defaults.get(r.command) ?? '').split('  ·  ').filter(Boolean), formatKey(r.key)].join('  ·  '),
      );
    }
    const ids = [...new Set([...defaults.keys(), ...keybindings.boundCommands()])];
    const q = filter.toLowerCase();
    return ids
      .map((id) => {
        const keys = keybindings.lookupAll(id).map(formatSequence).join('  ·  ');
        return {
          id,
          title: commandTitle(id),
          keys,
          custom: keys !== (defaults.get(id) ?? ''),
          available: commands.has(id),
        };
      })
      .filter(
        (r) =>
          !q || r.title.toLowerCase().includes(q) || r.keys.toLowerCase().includes(q) || r.id.includes(q),
      );
  }, [filter, version]);

  return (
    <Modal title={k.title} onClose={onClose} width={720}>
      <TextInput
        icon="search"
        placeholder={k.filter}
        aria-label={k.filter}
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        data-autofocus
      />
      <div className="keybindings-table" role="table">
        <div className="keybindings-row is-header" role="row">
          <span role="columnheader">{k.command}</span>
          <span role="columnheader">{k.key}</span>
          <span role="columnheader">{k.id}</span>
        </div>
        {rows.map((r) => (
          <div
            key={r.id}
            className={['keybindings-row', r.available ? '' : 'is-pending'].join(' ')}
            role="row"
          >
            <span role="cell">
              {r.title}
              {!r.available && <em> ({k.pending})</em>}
              {r.custom && <em> ({k.custom})</em>}
            </span>
            <span role="cell" className="keybindings-keys">
              {r.keys}
            </span>
            <span role="cell" className="keybindings-id">
              {r.id}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function Dialogs(): React.JSX.Element | null {
  const dialog = useOverlayStore((s) => s.dialog);
  const close = useOverlayStore((s) => s.closeDialog);
  if (!dialog) return null;
  switch (dialog.id) {
    case 'about':
      return <AboutDialog onClose={close} />;
    case 'keybindings':
      return <KeybindingsDialog onClose={close} />;
    case 'connection':
      return (
        <ConnectionDialog
          key={dialog.editId ?? 'new'}
          editId={dialog.editId}
          folder={dialog.folder}
          onClose={close}
        />
      );
    case 'password':
      return <PasswordDialog connectionId={dialog.connectionId} onResult={dialog.onResult} onClose={close} />;
    case 'confirm':
      return <ConfirmDialog {...dialog} onClose={close} />;
    case 'prompt':
      return <PromptDialog {...dialog} onClose={close} />;
    case 'choice':
      return <ChoiceDialog {...dialog} onClose={close} />;
    case 'writeConfirm':
      return <WriteConfirmDialog {...dialog} onClose={close} />;
    case 'sqlPreview':
      return <SqlPreviewDialog {...dialog} onClose={close} />;
    case 'export':
      return <ExportDialog {...dialog} onClose={close} />;
    case 'backup':
      return (
        <BackupDialog
          connectionId={dialog.connectionId}
          database={dialog.database}
          kind={dialog.kind}
          onClose={close}
        />
      );
    case 'tools':
      return <ToolsDialog family={dialog.family} onDone={dialog.onDone} onClose={close} />;
    case 'compare':
      return <CompareDialog tabId={dialog.tabId} name={dialog.name} disk={dialog.disk} onClose={close} />;
  }
}
