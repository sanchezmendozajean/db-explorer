/**
 * Protocolo de mensajes entre main y el proceso db-host (utilityProcess).
 * Petición/respuesta correlacionadas por `id`, más eventos sin respuesta.
 */

export interface DbHostPong {
  echo: string;
  pid: number;
  uptimeMs: number;
  versions: { node: string; electron: string };
}

export interface DbHostMethods {
  ping: { params: { message: string }; result: DbHostPong };
}

export type DbHostMethod = keyof DbHostMethods;

export interface DbHostRequest<M extends DbHostMethod = DbHostMethod> {
  kind: 'request';
  id: number;
  method: M;
  params: DbHostMethods[M]['params'];
}

export type DbHostResponse =
  | { kind: 'response'; id: number; ok: true; result: unknown }
  | { kind: 'response'; id: number; ok: false; error: { message: string } };

export interface DbHostReadyEvent {
  kind: 'ready';
}

export type DbHostOutgoing = DbHostResponse | DbHostReadyEvent;

export function isDbHostRequest(value: unknown): value is DbHostRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v['kind'] === 'request' && typeof v['id'] === 'number' && typeof v['method'] === 'string';
}

export function isDbHostOutgoing(value: unknown): value is DbHostOutgoing {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v['kind'] === 'ready' || (v['kind'] === 'response' && typeof v['id'] === 'number');
}
