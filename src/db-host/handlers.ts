import type { DbHostMethod, DbHostMethods, DbHostResponse } from '@shared/db-host-protocol';
import { isDbHostRequest } from '@shared/db-host-protocol';

export type DbHostHandlers = {
  [M in DbHostMethod]: (params: DbHostMethods[M]['params']) => Promise<DbHostMethods[M]['result']>;
};

export function createHandlers(startedAt: number, now: () => number = Date.now): DbHostHandlers {
  return {
    async ping({ message }) {
      return {
        echo: message,
        pid: process.pid,
        uptimeMs: Math.max(0, now() - startedAt),
        versions: {
          node: process.versions.node,
          electron: process.versions['electron'] ?? 'desconocida',
        },
      };
    },
  };
}

/**
 * Despacha un mensaje entrante al manejador correspondiente.
 * Devuelve `null` si el mensaje no es una petición válida (se ignora).
 */
export async function dispatch(message: unknown, handlers: DbHostHandlers): Promise<DbHostResponse | null> {
  if (!isDbHostRequest(message)) return null;
  const { id, method } = message;
  const handler = (handlers as Partial<Record<string, (params: unknown) => Promise<unknown>>>)[method];
  if (!handler) {
    return { kind: 'response', id, ok: false, error: { message: `Método desconocido: ${String(method)}` } };
  }
  try {
    const result = await handler(message.params);
    return { kind: 'response', id, ok: true, result };
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    return { kind: 'response', id, ok: false, error: { message: text } };
  }
}
