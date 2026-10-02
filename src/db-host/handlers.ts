import type {
  DbHostErrorPayload,
  DbHostMethod,
  DbHostMethods,
  DbHostResponse,
} from '@shared/db-host-protocol';
import { isDbHostRequest } from '@shared/db-host-protocol';
import { ConnectionManager } from './connection-manager';
import { DriverError } from './drivers/types';

export type DbHostHandlers = {
  [M in DbHostMethod]: (params: DbHostMethods[M]['params']) => Promise<DbHostMethods[M]['result']>;
};

export function createHandlers(
  startedAt: number,
  now: () => number = Date.now,
  connections: ConnectionManager = new ConnectionManager(),
): DbHostHandlers {
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
    'conn.test': ({ config, secret }) => connections.test(config, secret),
    'conn.open': ({ config, secret }) => connections.connect(config, secret),
    'conn.close': async ({ id }) => {
      await connections.disconnect(id);
      return null;
    },
    'meta.children': ({ connectionId, ref }) => connections.children(connectionId, ref),
    'meta.count': ({ connectionId, ...ref }) => connections.countRows(connectionId, ref),
    'query.execute': (req) => connections.execute(req),
    'query.fetchMore': (req) => connections.fetchMore(req),
    'query.cancel': async ({ queryId }) => {
      await connections.queries.cancel(queryId);
      return null;
    },
    'session.close': async ({ sessionId }) => {
      await connections.queries.closeSession(sessionId);
      return null;
    },
    'session.end-transaction': async ({ sessionId, commit }) => {
      await connections.queries.endTransaction(sessionId, commit);
      return null;
    },
    'meta.table': ({ connectionId, kind, ...ref }) => connections.tableDetails(connectionId, ref, kind),
    'meta.ddl': ({ connectionId, kind, ...ref }) => connections.ddl(connectionId, ref, kind),
    'data.apply': (req) => connections.apply(req),
    'export.start': (req) => connections.export(req),
  };
}

function toErrorPayload(err: unknown): DbHostErrorPayload {
  if (err instanceof DriverError) return { message: err.message, code: err.code };
  return { message: err instanceof Error ? err.message : String(err) };
}

/**
 * Despacha un mensaje entrante al manejador correspondiente.
 * Devuelve `null` si el mensaje no es una petición válida (se ignora).
 */
export async function dispatch(
  message: unknown,
  handlers: Partial<DbHostHandlers>,
): Promise<DbHostResponse | null> {
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
    return { kind: 'response', id, ok: false, error: toErrorPayload(err) };
  }
}
