import { useEffect, useMemo, useState } from 'react';
import type { IpcError, PingResult } from '@shared/ipc';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { TextInput } from '../../components/Inputs';
import { commands, keybindings } from '../../commands/service';
import { DEFAULT_KEYBINDINGS } from '../../commands/default-keybindings';
import { formatSequence } from '../../commands/keybindings';
import { commandTitle, es } from '../../i18n/es';
import { useOverlayStore } from '../../stores/overlay-store';

type PingState =
  { status: 'pending' } | { status: 'ok'; result: PingResult } | { status: 'error'; error: IpcError };

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
  const rows = useMemo(() => {
    const ids = [...new Set(DEFAULT_KEYBINDINGS.map((r) => r.command))];
    const q = filter.toLowerCase();
    return ids
      .map((id) => ({
        id,
        title: commandTitle(id),
        keys: keybindings.lookupAll(id).map(formatSequence).join('  ·  '),
        available: commands.has(id),
      }))
      .filter(
        (r) =>
          !q || r.title.toLowerCase().includes(q) || r.keys.toLowerCase().includes(q) || r.id.includes(q),
      );
  }, [filter]);

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
  if (dialog === 'about') return <AboutDialog onClose={close} />;
  if (dialog === 'keybindings') return <KeybindingsDialog onClose={close} />;
  return null;
}
