import { z } from 'zod';
import type { HistoryEntry } from './history';
import { HistoryQuerySchema } from './history';
import type { UserKeybindings } from './keybindings';
import type { IpcEventChannel, IpcInvokeChannel } from './channels';
import { UiStateSchema } from './ui-state';
import type { ServerInfo } from './connection';
import { ConnectionConfigSchema } from './connection';
import type { TableDetails, TreeNodeData } from './metadata';
import { ObjectKindSchema, TreeNodeRefSchema } from './metadata';
import type { ApplyChangesResult, ExecuteSummary, ExportSummary, FetchMoreResult, QueryEvent } from './query';
import type { Settings } from './settings';
import type { FileNode, ScriptFile, WorkspaceInfo } from './workspace';
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
  autoCommit: z.boolean().optional(),
  history: z.boolean().optional(),
  explain: z.object({ analyze: z.boolean(), write: z.boolean() }).optional(),
});

const SessionId = z.string().min(1).max(4200);

export const ObjectTargetSchema = z.object({
  connectionId: Id,
  database: Name,
  schema: Name,
  name: Name,
  kind: ObjectKindSchema,
});

const Cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const LogicalTypeSchema = z.enum([
  'integer',
  'decimal',
  'float',
  'boolean',
  'text',
  'date',
  'time',
  'datetime',
  'datetimetz',
  'json',
  'binary',
  'uuid',
  'other',
]);

const SessionTargetShape = {
  sessionId: SessionId,
  connectionId: Id,
  database: Name.optional(),
  schema: Name.optional(),
  autoCommit: z.boolean().optional(),
};

export const ApplyChangesSchema = z.object({
  ...SessionTargetShape,
  statements: z
    .array(
      z.object({
        sql: z.string().max(1_000_000),
        params: z.array(Cell).max(10_000),
        types: z.array(LogicalTypeSchema).max(10_000),
        expectOne: z.boolean(),
      }),
    )
    .min(1)
    .max(100_000),
});

export const ExportFormatSchema = z.enum(['csv', 'json', 'xlsx', 'sql']);

const ResultColumnSchema = z.object({
  name: z.string().max(1000),
  nativeType: z.string().max(1000),
  logicalType: LogicalTypeSchema,
  sourceSchema: z.string().max(1000).optional(),
  sourceTable: z.string().max(1000).optional(),
  sourceColumn: z.string().max(1000).optional(),
  isPk: z.boolean().optional(),
});

export const ExportRequestSchema = z.object({
  exportId: QueryId,
  /** Ruta elegida en el diálogo de `data:pick-export-path` (main rechaza otras). */
  path: z.string().min(1).max(4096),
  format: ExportFormatSchema,
  options: z.object({
    separator: z.string().min(1).max(4),
    header: z.boolean(),
    bom: z.boolean(),
    table: z.string().max(4000),
    engine: z.enum(['postgres', 'mariadb', 'sqlite', 'sqlserver']).optional(),
  }),
  columns: z.array(ResultColumnSchema).min(1).max(10_000),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('rows'), rows: z.array(z.array(Cell)).max(10_000_000) }),
    z.object({
      kind: z.literal('query'),
      ...SessionTargetShape,
      sql: z.string().min(1).max(50_000_000),
      columnIndexes: z.array(z.number().int().nonnegative()).min(1).max(10_000),
    }),
  ]),
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

const FilePaths = z.array(FilePath).min(1).max(1000);

export const SaveAsSchema = z.object({
  /** Nombre sugerido en el diálogo (se abre en la carpeta del espacio o la del archivo). */
  defaultPath: FilePath,
  content: z.string().max(100_000_000),
  bom: z.boolean(),
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
  'app:clipboard-read': { request: Empty, response: z.object({ text: z.string() }) },
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
  'settings:get-keybindings': { request: Empty, response: z.custom<UserKeybindings>() },
  /** Abre (creando con una plantilla si falta) `settings.json` o `keybindings.json`; devuelve su ruta. */
  'settings:open-file': {
    request: z.object({ file: z.enum(['settings', 'keybindings']) }),
    response: z.object({ path: z.string() }),
  },
  'fs:open-workspace': {
    /** `useDefault`: abrir el predeterminado sin cambiar la configuración (espacio no disponible). */
    request: z.object({ useDefault: z.boolean().optional() }),
    response: z.custom<WorkspaceInfo>(),
  },
  'fs:save-workspace-state': { request: WorkspaceStateSchema, response: Empty },
  'fs:new-script': { request: Empty, response: z.object({ path: z.string() }) },
  'fs:list-files': { request: Empty, response: z.custom<FileNode[]>() },
  'fs:read-script': { request: z.object({ path: FilePath }), response: z.custom<ScriptFile>() },
  'fs:write-script': { request: WriteScriptSchema, response: z.object({ mtimeMs: z.number() }) },
  'fs:delete-empty-script': {
    request: z.object({ path: FilePath }),
    response: z.object({ deleted: z.boolean() }),
  },
  'fs:list-dir': { request: z.object({ path: FilePath }), response: z.custom<FileNode[]>() },
  'fs:create': {
    request: z.object({ dir: FilePath, name: z.string().min(1).max(255), kind: z.enum(['file', 'folder']) }),
    response: z.object({ path: z.string() }),
  },
  'fs:rename': {
    request: z.object({ path: FilePath, name: z.string().min(1).max(255) }),
    response: z.object({ path: z.string() }),
  },
  'fs:move': {
    request: z.object({ paths: FilePaths, targetDir: FilePath }),
    response: z.object({ moved: z.array(z.object({ from: z.string(), to: z.string() })) }),
  },
  'fs:copy': {
    request: z.object({ paths: FilePaths, targetDir: FilePath }),
    response: z.object({ created: z.array(z.string()) }),
  },
  'fs:trash': { request: z.object({ paths: FilePaths }), response: Empty },
  'fs:reveal': { request: z.object({ path: FilePath }), response: Empty },
  'fs:open-external': { request: z.object({ path: FilePath }), response: Empty },
  'fs:pick-folder': {
    request: z.object({ title: z.string().max(200) }),
    response: z.object({ path: z.string().nullable() }),
  },
  'fs:switch-workspace': {
    /** `null` = volver al predeterminado (quita `workspace.path`). */
    request: z.object({ path: FilePath.nullable() }),
    response: z.custom<WorkspaceInfo>(),
  },
  'fs:recent-workspaces': { request: Empty, response: z.object({ paths: z.array(z.string()) }) },
  'fs:open-file-dialog': {
    request: z.object({ title: z.string().max(200) }),
    response: z.object({ path: z.string().nullable() }),
  },
  'fs:save-as': {
    request: SaveAsSchema,
    response: z.object({ path: z.string().nullable(), mtimeMs: z.number() }),
  },
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
  'query:end-transaction': {
    request: z.object({ sessionId: SessionId, commit: z.boolean() }),
    response: Empty,
  },
  'meta:table': { request: ObjectTargetSchema, response: z.custom<TableDetails>() },
  'meta:ddl': { request: ObjectTargetSchema, response: z.object({ ddl: z.string() }) },
  'data:apply': { request: ApplyChangesSchema, response: z.custom<ApplyChangesResult>() },
  /** Diálogo "Guardar como" de una exportación; la ruta queda autorizada para `data:export`. */
  'data:pick-export-path': {
    request: z.object({ format: ExportFormatSchema, defaultName: z.string().min(1).max(255) }),
    response: z.object({ path: z.string().nullable() }),
  },
  'data:export': { request: ExportRequestSchema, response: z.custom<ExportSummary>() },
  'query:history-list': { request: HistoryQuerySchema, response: z.custom<HistoryEntry[]>() },
  'query:history-delete': { request: z.object({ id: z.number().int().positive() }), response: Empty },
  'query:history-clear': { request: Empty, response: Empty },
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
  /** `keybindings.json` cambió (al guardarlo o desde otro editor). */
  'settings:keybindings-changed': z.custom<UserKeybindings>(),
  /** Rutas del espacio que cambiaron en disco (watcher, agrupadas cada 200 ms). */
  'fs:changed': z.object({ paths: z.array(z.string()) }),
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
  | 'conflict'
  /** Ya existe un archivo o carpeta con ese nombre. */
  | 'exists'
  /** Nombre de archivo no válido. */
  | 'invalid-name';

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
