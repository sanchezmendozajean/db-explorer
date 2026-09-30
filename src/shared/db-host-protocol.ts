import type { ConnectionConfig, ServerInfo } from './connection';
import type { TreeNodeData, TreeNodeRef } from './metadata';
import type {
  ExecuteRequest,
  ExecuteSummary,
  FetchMoreRequest,
  FetchMoreResult,
  QueryEvent,
} from './query';

/**
 * Protocolo de mensajes entre main y el proceso db-host (utilityProcess).
 * Petición/respuesta correlacionadas por `id`, más eventos sin respuesta.
 * Las contraseñas (`secret`) solo viajan main → db-host, nunca al renderer.
 */

export interface DbHostPong {
  echo: string;
  pid: number;
  uptimeMs: number;
  versions: { node: string; electron: string };
}

export interface DbHostMethods {
  ping: { params: { message: string }; result: DbHostPong };
  'conn.test': { params: { config: ConnectionConfig; secret?: string }; result: ServerInfo };
  'conn.open': { params: { config: ConnectionConfig; secret?: string }; result: ServerInfo };
  'conn.close': { params: { id: string }; result: null };
  'meta.children': { params: { connectionId: string; ref: TreeNodeRef }; result: TreeNodeData[] };
  'meta.count': {
    params: { connectionId: string; database: string; schema: string; name: string };
    result: number;
  };
  'query.execute': { params: ExecuteRequest; result: ExecuteSummary };
  'query.fetchMore': { params: FetchMoreRequest; result: FetchMoreResult };
  'query.cancel': { params: { queryId: string }; result: null };
  'session.close': { params: { sessionId: string }; result: null };
}

export type DbHostMethod = keyof DbHostMethods;

export interface DbHostRequest<M extends DbHostMethod = DbHostMethod> {
  kind: 'request';
  id: number;
  method: M;
  params: DbHostMethods[M]['params'];
}

export interface DbHostErrorPayload {
  message: string;
  code?: string;
}

export type DbHostResponse =
  | { kind: 'response'; id: number; ok: true; result: unknown }
  | { kind: 'response'; id: number; ok: false; error: DbHostErrorPayload };

export interface DbHostReadyEvent {
  kind: 'ready';
}

/** Evento de ejecución (filas en lotes, mensajes, fin de sentencia). */
export interface DbHostQueryEvent {
  kind: 'query-event';
  event: QueryEvent;
}

export type DbHostOutgoing = DbHostResponse | DbHostReadyEvent | DbHostQueryEvent;

export function isDbHostRequest(value: unknown): value is DbHostRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v['kind'] === 'request' && typeof v['id'] === 'number' && typeof v['method'] === 'string';
}

export function isDbHostOutgoing(value: unknown): value is DbHostOutgoing {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v['kind'] === 'ready' ||
    (v['kind'] === 'query-event' && typeof v['event'] === 'object') ||
    (v['kind'] === 'response' && typeof v['id'] === 'number')
  );
}
