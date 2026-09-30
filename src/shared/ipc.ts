import { z } from 'zod';
import type { IpcEventChannel, IpcInvokeChannel } from './channels';
import { UiStateSchema } from './ui-state';
import type { ServerInfo } from './connection';
import { ConnectionConfigSchema } from './connection';
import type { TreeNodeData } from './metadata';
import { TreeNodeRefSchema } from './metadata';
import type { ExecuteSummary, FetchMoreResult, QueryEvent } from './query';
import type { Settings } from './settings';
import type { ScriptFile, WorkspaceInfo } from './workspace';
import { WorkspaceStateSchema } from './workspace';

/**
 * Contrato IPC entre renderer y main. Cada canal de petición declara el
 * esquema de su payload (validado en main) y el de su respuesta.
 */

const Empty = z.object({}).strict();

export const PingRequestSchema = z.object({
  message: z.string().max(200),
});

export const PingResultSchema = z.object({
  /** Mensaje devuelto por el db-host (eco del enviado). */
  echo: z.string(),
  dbHostPid: z.number().int(),
  dbHostUptimeMs: z.number().nonnegative(),
  /** Tiempo de ida y vuelta main → db-host → main, en milisegundos. */
  roundTripMs: z.number().nonnegative(),
  versions: z.object({
    node: z.string(),
    electron: z.string(),
  }),
});

export const WindowStateSchema = z.object({
  maximized: z.boolean(),
});

export const WindowControlSchema = z.object({
  action: z.enum(['minimize', 'toggle-maximize', 'close']),
});

export const ZoomRequestSchema = z.object({
  action: z.enum(['in', 'out', 'reset']),
});

export const EditRequestSchema = z.object({
  action: z.enum(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']),
});

export const ClipboardWriteSchema = z.object({
  text: z.string().max(10_000_000),
});

export const OpenFileDialogSchema = z.object({
  title: z.string().max(200),
  defaultPath: z.string().max(4096).optional(),
  /** Permite escribir un nombre de archivo que aún no existe (SQLite "crear si no existe"). */
  allowCreate: z.boolean().optional(),
  filters: z
    .array(z.object({ name: z.string().max(100), extensions: z.array(z.string().max(20)).max(20) }))
    .max(10),
});

const Id = z.string().min(1).max(64);
const Password = z.string().max(1000);
const ServerInfoResponse = z.custom<ServerInfo>();

export const ConnectionListSchema = z.object({
  folders: z.array(z.string()),
  connections: z.array(ConnectionConfigSchema),
  /** Ids de conexiones con contraseña guardada: el renderer nunca recibe la contraseña. */
  savedPasswordIds: z.array(z.string()),
  encryptionAvailable: z.boolean(),
  /** Entradas inválidas omitidas al leer connections.json. */
  skipped: z.number().int(),
});

export const SaveConnectionSchema = z.object({
  config: ConnectionConfigSchema,
  /** Sin valor: conservar la guardada; null: borrarla; texto: reemplazarla. */
  password: Password.nullable().optional(),
  /** Al duplicar: copia la contraseña guardada de otra conexión. */
  copyPasswordFrom: Id.optional(),
});

export const SetLayoutSchema = z.object({
  folders: z.array(z.string().trim().min(1).max(120)).max(500),
  order: z.array(z.object({ id: Id, folder: z.string().max(120).optional() })).max(10_000),
});

export const TestConnectionSchema = z.object({
  config: ConnectionConfigSchema,
  password: Password.optional(),
  /** Usa la contraseña guardada de esta conexión (edición sin cambiar la contraseña). */
  useSavedPasswordOf: Id.optional(),
});

export const ConnectSchema = z.object({ id: Id, password: Password.optional() });

export const ChildrenSchema = z.object({ connectionId: Id, ref: TreeNodeRefSchema });

const Name = z.string().max(1000);
export const CountRowsSchema = z.object({ connectionId: Id, database: Name, schema: Name, name: Name });

const QueryId = z.string().min(1).max(100);

export const ExecuteRequestSchema = z.object({
  queryId: QueryId,
  sessionId: z.string().min(1).max(4200),
  connectionId: Id,
  database: Name.optional(),
  schema: Name.optional(),
  statements: z.array(z.string().max(50_000_000)).min(1).max(100_000),
  maxRows: z.number().int().positive().nullable(),
});

export const FetchMoreRequestSchema = z.object({
  queryId: QueryId,
  statementIndex: z.number().int().nonnegative(),
  count: z.number().int().positive().nullable(),
});

export const SettingsUpdateSchema = z.object({
  key: z.string().min(1).max(200),
  /** `undefined` quita la clave del archivo. */
  value: z.unknown(),
});

const FilePath = z.string().min(1).max(4096);

export const WriteScriptSchema = z.object({
  path: FilePath,
  content: z.string().max(100_000_000),
  bom: z.boolean(),
  /** `mtime` de la última lectura/escritura; si el archivo cambió, no se sobrescribe. */
  expectedMtimeMs: z.number().optional(),
  force: z.boolean().optional(),
});

export const ipcInvokeContract = {
  'app:ping': { request: PingRequestSchema, response: PingResultSchema },
  'app:get-ui-state': { request: Empty, response: UiStateSchema },
  'app:set-ui-state': { request: UiStateSchema, response: Empty },
  'app:window-control': { request: WindowControlSchema, response: WindowStateSchema },
  'app:get-window-state': { request: Empty, response: WindowStateSchema },
  'app:zoom': { request: ZoomRequestSchema, response: z.object({ level: z.number() }) },
  'app:edit': { request: EditRequestSchema, response: Empty },
  'app:clipboard-write': { request: ClipboardWriteSchema, response: Empty },
  'app:open-file-dialog': {
    request: OpenFileDialogSchema,
    response: z.object({ path: z.string().nullable() }),
  },
  'app:close-ready': {
    /** `listening`: el renderer se encarga de guardar antes de cerrar; `ready`: ya puede cerrarse. */
    request: z.object({ phase: z.enum(['listening', 'ready']) }),
    response: Empty,
  },
  'settings:get': { request: Empty, response: z.custom<Settings>() },
  'settings:update': { request: SettingsUpdateSchema, response: z.custom<Settings>() },
  'workspace:open': { request: Empty, response: z.custom<WorkspaceInfo>() },
  'workspace:save-state': { request: WorkspaceStateSchema, response: Empty },
  'workspace:new-script': { request: Empty, response: z.object({ path: z.string() }) },
  'fs:read-script': { request: z.object({ path: FilePath }), response: z.custom<ScriptFile>() },
  'fs:write-script': { request: WriteScriptSchema, response: z.object({ mtimeMs: z.number() }) },
  'fs:delete-empty-script': { request: z.object({ path: FilePath }), response: z.object({ deleted: z.boolean() }) },
  'conn:list': { request: Empty, response: ConnectionListSchema },
  'conn:save': { request: SaveConnectionSchema, response: z.object({ config: ConnectionConfigSchema }) },
  'conn:delete': { request: z.object({ id: Id }), response: Empty },
  'conn:set-layout': { request: SetLayoutSchema, response: Empty },
  'conn:test': { request: TestConnectionSchema, response: ServerInfoResponse },
  'conn:connect': { request: ConnectSchema, response: ServerInfoResponse },
  'conn:disconnect': { request: z.object({ id: Id }), response: Empty },
  'meta:children': { request: ChildrenSchema, response: z.custom<TreeNodeData[]>() },
  'meta:count': { request: CountRowsSchema, response: z.object({ count: z.number() }) },
  'query:execute': { request: ExecuteRequestSchema, response: z.custom<ExecuteSummary>() },
  'query:fetch-more': { request: FetchMoreRequestSchema, response: z.custom<FetchMoreResult>() },
  'query:cancel': { request: z.object({ queryId: QueryId }), response: Empty },
  'query:close-session': { request: z.object({ sessionId: z.string().min(1).max(4200) }), response: Empty },
} as const satisfies Record<IpcInvokeChannel, { request: z.ZodType; response: z.ZodType }>;

export const DbHostRestartedEventSchema = z.object({
  reason: z.string(),
});

export const ipcEventContract = {
  'app:db-host-restarted': DbHostRestartedEventSchema,
  'app:window-state': WindowStateSchema,
  /** La ventana se va a cerrar: el renderer guarda y responde con `app:close-ready`. */
  'app:before-close': Empty,
  'settings:changed': z.custom<Settings>(),
  'query:event': z.custom<QueryEvent>(),
} as const satisfies Record<IpcEventChannel, z.ZodType>;

export type IpcRequest<C extends IpcInvokeChannel> = z.infer<(typeof ipcInvokeContract)[C]['request']>;
export type IpcResponse<C extends IpcInvokeChannel> = z.infer<(typeof ipcInvokeContract)[C]['response']>;
export type IpcEventPayload<C extends IpcEventChannel> = z.infer<(typeof ipcEventContract)[C]>;

export type IpcErrorCode =
  | 'invalid-payload'
  | 'forbidden'
  | 'db-host-unavailable'
  | 'timeout'
  | 'internal'
  | 'not-found'
  /** La conexión no tiene contraseña guardada: el renderer debe pedirla. */
  | 'password-required'
  /** Error del motor de base de datos (mensaje del servidor). */
  | 'db-error'
  | 'engine-unavailable'
  /** La conexión no está abierta en el db-host (p. ej. tras reiniciarse). */
  | 'not-connected'
  /** La sesión ya está ejecutando otra consulta. */
  | 'busy'
  /** El archivo cambió en disco desde la última lectura. */
  | 'conflict';

export interface IpcError {
  code: IpcErrorCode;
  message: string;
}

/** Toda respuesta IPC viaja envuelta: nunca se lanzan excepciones a través del puente. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError };

export type PingRequest = IpcRequest<'app:ping'>;
export type PingResult = IpcResponse<'app:ping'>;
export type WindowState = IpcResponse<'app:get-window-state'>;
export type ConnectionList = IpcResponse<'conn:list'>;
export type SaveConnectionRequest = IpcRequest<'conn:save'>;
