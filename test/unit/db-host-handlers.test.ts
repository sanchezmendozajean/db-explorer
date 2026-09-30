import { describe, expect, it } from 'vitest';
import { createHandlers, dispatch } from '../../src/db-host/handlers';

describe('db-host: manejadores', () => {
  const handlers = createHandlers(1_000, () => 1_250);

  it('ping devuelve eco, pid y tiempo activo', async () => {
    const pong = await handlers.ping({ message: 'hola' });
    expect(pong.echo).toBe('hola');
    expect(pong.pid).toBe(process.pid);
    expect(pong.uptimeMs).toBe(250);
    expect(pong.versions.node).toBe(process.versions.node);
  });

  it('dispatch responde con el mismo id', async () => {
    const res = await dispatch(
      { kind: 'request', id: 7, method: 'ping', params: { message: 'x' } },
      handlers,
    );
    expect(res).toMatchObject({ kind: 'response', id: 7, ok: true, result: { echo: 'x' } });
  });

  it('dispatch ignora mensajes que no son peticiones', async () => {
    expect(await dispatch({ foo: 1 }, handlers)).toBeNull();
    expect(await dispatch(null, handlers)).toBeNull();
    expect(await dispatch('ping', handlers)).toBeNull();
  });

  it('dispatch informa métodos desconocidos sin lanzar', async () => {
    const res = await dispatch({ kind: 'request', id: 1, method: 'noExiste', params: {} }, handlers);
    expect(res).toMatchObject({ id: 1, ok: false });
  });

  it('dispatch convierte excepciones en respuestas de error', async () => {
    const failing = {
      ping: async () => {
        throw new Error('fallo');
      },
    };
    const res = await dispatch({ kind: 'request', id: 2, method: 'ping', params: { message: '' } }, failing);
    expect(res).toEqual({ kind: 'response', id: 2, ok: false, error: { message: 'fallo' } });
  });
});
