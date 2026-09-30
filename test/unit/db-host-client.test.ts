import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DbHostRequest } from '@shared/db-host-protocol';
import { createHandlers, dispatch } from '../../src/db-host/handlers';
import type { DbHostTransport } from '../../src/main/services/db-host-client';
import {
  DbHostClient,
  DbHostTimeoutError,
  DbHostUnavailableError,
} from '../../src/main/services/db-host-client';

/** Transporte falso que simula el db-host en memoria. */
class FakeTransport implements DbHostTransport {
  sent: DbHostRequest[] = [];
  killed = false;
  autoRespond = true;
  private messageListener: ((m: unknown) => void) | undefined;
  private exitListener: ((code: number) => void) | undefined;
  private readonly handlers = createHandlers(0);

  postMessage(message: DbHostRequest): void {
    this.sent.push(message);
    if (!this.autoRespond) return;
    void dispatch(message, this.handlers).then((res) => this.messageListener?.(res));
  }
  onMessage(listener: (m: unknown) => void): void {
    this.messageListener = listener;
  }
  onExit(listener: (code: number) => void): void {
    this.exitListener = listener;
  }
  kill(): void {
    this.killed = true;
  }
  crash(code = 1): void {
    this.exitListener?.(code);
  }
  emit(message: unknown): void {
    this.messageListener?.(message);
  }
}

function setup(options: ConstructorParameters<typeof DbHostClient>[1] = {}) {
  const transports: FakeTransport[] = [];
  const client = new DbHostClient(() => {
    const t = new FakeTransport();
    transports.push(t);
    return t;
  }, options);
  client.start();
  return { client, transports };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DbHostClient', () => {
  it('correlaciona petición y respuesta', async () => {
    const { client } = setup();
    const pong = await client.request('ping', { message: 'hola' });
    expect(pong.echo).toBe('hola');
  });

  it('atiende peticiones concurrentes por id', async () => {
    const { client, transports } = setup();
    transports[0]!.autoRespond = false;
    const a = client.request('ping', { message: 'a' });
    const b = client.request('ping', { message: 'b' });
    const [reqA, reqB] = transports[0]!.sent;
    const base = { pid: 1, uptimeMs: 0, versions: { node: '', electron: '' } };
    transports[0]!.emit({ kind: 'response', id: reqB!.id, ok: true, result: { ...base, echo: 'B' } });
    transports[0]!.emit({ kind: 'response', id: reqA!.id, ok: true, result: { ...base, echo: 'A' } });
    expect((await a).echo).toBe('A');
    expect((await b).echo).toBe('B');
  });

  it('rechaza por tiempo de espera', async () => {
    vi.useFakeTimers();
    const { client, transports } = setup({ timeoutMs: 100 });
    transports[0]!.autoRespond = false;
    const p = client.request('ping', { message: 'x' });
    vi.advanceTimersByTime(101);
    await expect(p).rejects.toBeInstanceOf(DbHostTimeoutError);
  });

  it('si el proceso se cae rechaza lo pendiente, reinicia y avisa', async () => {
    const onRestart = vi.fn();
    const { client, transports } = setup({ onRestart });
    transports[0]!.autoRespond = false;
    const p = client.request('ping', { message: 'x' });
    transports[0]!.crash(3);
    await expect(p).rejects.toBeInstanceOf(DbHostUnavailableError);
    expect(transports).toHaveLength(2);
    expect(onRestart).toHaveBeenCalledWith('código de salida 3');
    expect((await client.request('ping', { message: 'otra vez' })).echo).toBe('otra vez');
  });

  it('deja de reiniciar tras demasiadas caídas seguidas', () => {
    const { client, transports } = setup({ maxRestarts: 2, now: () => 0 });
    transports[0]!.crash();
    transports[1]!.crash();
    transports[2]!.crash();
    expect(transports).toHaveLength(3);
    expect(client.isRunning).toBe(false);
  });

  it('dispose mata el proceso y no reinicia', async () => {
    const onRestart = vi.fn();
    const { client, transports } = setup({ onRestart });
    client.dispose();
    expect(transports[0]!.killed).toBe(true);
    transports[0]!.crash();
    expect(onRestart).not.toHaveBeenCalled();
    await expect(client.request('ping', { message: 'x' })).rejects.toBeInstanceOf(DbHostUnavailableError);
  });

  it('las peticiones con timeoutMs null no vencen', async () => {
    vi.useFakeTimers();
    const { client, transports } = setup({ timeoutMs: 100 });
    transports[0]!.autoRespond = false;
    const pending = client.request('ping', { message: 'x' }, { timeoutMs: null });
    vi.advanceTimersByTime(10_000);
    const sent = transports[0]!.sent[0]!;
    transports[0]!.emit({ kind: 'response', id: sent.id, ok: true, result: { echo: 'x' } });
    await expect(pending).resolves.toMatchObject({ echo: 'x' });
  });

  it('entrega los eventos de ejecución', () => {
    const onQueryEvent = vi.fn();
    const { transports } = setup({ onQueryEvent });
    const event = { type: 'message', queryId: 'q', index: 0, severity: 'notice', text: 'hola' };
    transports[0]!.emit({ kind: 'query-event', event });
    expect(onQueryEvent).toHaveBeenCalledWith(event);
  });
});
