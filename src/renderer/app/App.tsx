import { useCallback, useEffect, useState } from 'react';
import type { IpcError, PingResult } from '@shared/ipc';
import { es } from '../i18n/es';

type PingState =
  { status: 'pending' } | { status: 'ok'; result: PingResult } | { status: 'error'; error: IpcError };

export function App(): React.JSX.Element {
  const [ping, setPing] = useState<PingState>({ status: 'pending' });
  const [restartNotice, setRestartNotice] = useState<string | null>(null);

  const sendPing = useCallback(async () => {
    setPing({ status: 'pending' });
    const response = await window.api.app.ping({ message: es.ping.message });
    setPing(
      response.ok ? { status: 'ok', result: response.data } : { status: 'error', error: response.error },
    );
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ping inicial al montar
    void sendPing();
    return window.api.on('app:db-host-restarted', () => setRestartNotice(es.dbHost.restarted));
  }, [sendPing]);

  return (
    <main className="m0">
      <header>
        <h1>{es.app.name}</h1>
        <p className="muted">{es.app.subtitle}</p>
      </header>

      {restartNotice && (
        <div className="notice" role="status">
          {restartNotice}
        </div>
      )}

      <section className="card" aria-live="polite">
        <h2>{es.ping.title}</h2>
        {ping.status === 'pending' && <p data-testid="ping-status">{es.ping.pending}</p>}
        {ping.status === 'error' && (
          <p data-testid="ping-status" className="error">
            {es.ping.failure}: {ping.error.message}
          </p>
        )}
        {ping.status === 'ok' && (
          <>
            <p data-testid="ping-status" className="success">
              {es.ping.success}
            </p>
            <dl>
              <dt>{es.ping.echo}</dt>
              <dd data-testid="ping-echo">{ping.result.echo}</dd>
              <dt>{es.ping.pid}</dt>
              <dd>{ping.result.dbHostPid}</dd>
              <dt>{es.ping.roundTrip}</dt>
              <dd>{es.units.ms(ping.result.roundTripMs)}</dd>
              <dt>{es.ping.uptime}</dt>
              <dd>{es.units.ms(ping.result.dbHostUptimeMs)}</dd>
              <dt>{es.ping.electron}</dt>
              <dd>{ping.result.versions.electron}</dd>
              <dt>{es.ping.node}</dt>
              <dd>{ping.result.versions.node}</dd>
            </dl>
          </>
        )}
        <button type="button" onClick={() => void sendPing()}>
          {es.ping.retry}
        </button>
      </section>
    </main>
  );
}
