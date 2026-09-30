import { z } from 'zod';

/** Tipos de metadatos compartidos entre db-host, main y renderer (specs/03). */

export const ObjectKindSchema = z.enum([
  'table',
  'view',
  'materializedView',
  'function',
  'procedure',
  'sequence',
  'trigger',
]);
export type ObjectKind = z.infer<typeof ObjectKindSchema>;

export interface DriverCapabilities {
  databases: boolean;
  schemas: boolean;
  functions: boolean;
  procedures: boolean;
  sequences: boolean;
  triggers: boolean;
  materializedViews: boolean;
  cancel: boolean;
  multipleResultSets: boolean;
  batchSeparator?: 'GO';
}

export interface DbObject {
  name: string;
  /** Texto secundario: tamaño, filas estimadas, firma, tipo de retorno… */
  detail?: string;
  /** Objetos del sistema (esquemas `pg_*`, bases plantilla…). */
  system?: boolean;
}

export interface ColumnInfo {
  name: string;
  nativeType: string;
  nullable: boolean;
  defaultValue?: string;
  primaryKey: boolean;
  comment?: string;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
}

/**
 * Referencia a un nodo del árbol de objetos. El db-host sabe expandir cada
 * tipo según las `capabilities` del motor.
 */
export const TreeNodeRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('connection') }),
  z.object({ kind: z.literal('database'), database: z.string() }),
  z.object({ kind: z.literal('systemSchemas'), database: z.string() }),
  z.object({ kind: z.literal('schema'), database: z.string(), schema: z.string() }),
  z.object({
    kind: z.literal('objectFolder'),
    database: z.string(),
    schema: z.string(),
    objectKind: ObjectKindSchema,
  }),
  z.object({
    kind: z.literal('object'),
    database: z.string(),
    schema: z.string(),
    objectKind: ObjectKindSchema,
    name: z.string(),
  }),
  z.object({ kind: z.literal('indexFolder'), database: z.string(), schema: z.string(), table: z.string() }),
  z.object({
    kind: z.literal('column'),
    database: z.string(),
    schema: z.string(),
    table: z.string(),
    name: z.string(),
  }),
  z.object({
    kind: z.literal('index'),
    database: z.string(),
    schema: z.string(),
    table: z.string(),
    name: z.string(),
  }),
]);
export type TreeNodeRef = z.infer<typeof TreeNodeRefSchema>;

/** Nodo del árbol tal como lo devuelve el db-host. */
export interface TreeNodeData {
  ref: TreeNodeRef;
  label: string;
  secondary?: string;
  expandable: boolean;
  /** Cantidad de elementos de una carpeta ("Tablas (48)"). */
  count?: number;
  /** Columna que forma parte de la clave primaria (icono de llave). */
  primaryKey?: boolean;
}

/** Identificador estable de un nodo dentro de una conexión (nombres codificados para evitar colisiones). */
export function nodeKey(connectionId: string, ref: TreeNodeRef): string {
  const e = encodeURIComponent;
  const c = `c:${e(connectionId)}`;
  switch (ref.kind) {
    case 'connection':
      return c;
    case 'database':
      return `${c}/d:${e(ref.database)}`;
    case 'systemSchemas':
      return `${c}/d:${e(ref.database)}/sys`;
    case 'schema':
      return `${c}/d:${e(ref.database)}/s:${e(ref.schema)}`;
    case 'objectFolder':
      return `${c}/d:${e(ref.database)}/s:${e(ref.schema)}/f:${ref.objectKind}`;
    case 'object':
      return `${c}/d:${e(ref.database)}/s:${e(ref.schema)}/f:${ref.objectKind}/o:${e(ref.name)}`;
    case 'indexFolder':
      return `${c}/d:${e(ref.database)}/s:${e(ref.schema)}/t:${e(ref.table)}/idx`;
    case 'column':
      return `${c}/d:${e(ref.database)}/s:${e(ref.schema)}/t:${e(ref.table)}/col:${e(ref.name)}`;
    case 'index':
      return `${c}/d:${e(ref.database)}/s:${e(ref.schema)}/t:${e(ref.table)}/idx:${e(ref.name)}`;
  }
}
