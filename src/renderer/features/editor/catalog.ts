import type { Engine } from '@shared/connection';
import type { ObjectKind, TreeNodeData, TreeNodeRef } from '@shared/metadata';
import { nodeKey } from '@shared/metadata';
import type { TableMention } from '@shared/sql-context';
import { connectionById, useConnectionsStore } from '../../stores/connections-store';
import { useUiStore } from '../../stores/ui-store';
import { useWorkbenchStore } from '../../stores/workbench-store';

/**
 * Catálogo para autocompletado, hover, F12 y Ctrl+P (specs/05): sale de la
 * caché del árbol de conexiones (carga perezosa por esquema). Las columnas se
 * piden solo para las tablas que hacen falta: en bases con miles de tablas
 * (p. ej. SAP B1) traerlas todas sería muy pesado.
 */

/** Base y esquema donde se buscan los nombres sin calificar. */
export interface CatalogScope {
  connectionId: string;
  engine: Engine;
  database: string;
  /** Esquemas en orden de búsqueda (PostgreSQL: el elegido y luego `public`). */
  schemas: string[];
}

export interface CatalogObject {
  name: string;
  schema: string;
  database: string;
  kind: ObjectKind;
  /** Texto secundario del árbol (filas estimadas, firma…). */
  detail?: string;
}

export interface CatalogColumn {
  name: string;
  nativeType: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue?: string;
  comment?: string;
}

const TABLE_KINDS: ObjectKind[] = ['table', 'view', 'materializedView'];

const store = useConnectionsStore.getState;

function connected(connectionId: string): boolean {
  return store().status[connectionId]?.state === 'connected';
}

/** Ámbito de búsqueda según el motor (MariaDB: base = esquema; SQLite: `main`). */
export function catalogScope(
  connectionId: string | undefined,
  database: string | undefined,
  schema: string | undefined,
): CatalogScope | null {
  const engine = connectionById(connectionId)?.engine;
  if (!connectionId || !engine || !connected(connectionId)) return null;
  if (engine === 'sqlite') return { connectionId, engine, database: 'main', schemas: ['main'] };
  if (!database) return null;
  if (engine === 'mariadb') return { connectionId, engine, database, schemas: [database] };
  const schemas = engine === 'postgres' ? [schema ?? 'public', 'public'] : [schema ?? 'dbo'];
  return { connectionId, engine, database, schemas: [...new Set(schemas)] };
}

function folderRef(scope: CatalogScope, schema: string, objectKind: ObjectKind): TreeNodeRef {
  return { kind: 'objectFolder', database: scope.database, schema, objectKind };
}

async function children(connectionId: string, ref: TreeNodeRef): Promise<TreeNodeData[]> {
  const key = nodeKey(connectionId, ref);
  if (!store().children[key]) await store().loadChildren(connectionId, ref);
  return store().children[key] ?? [];
}

/** Tablas y vistas de un esquema. */
export async function objectsOf(scope: CatalogScope, schema: string): Promise<CatalogObject[]> {
  // Las vistas materializadas solo existen en PostgreSQL.
  const kinds = TABLE_KINDS.filter((k) => k !== 'materializedView' || scope.engine === 'postgres');
  const lists = await Promise.all(
    kinds.map((k) => children(scope.connectionId, folderRef(scope, schema, k))),
  );
  return lists.flatMap((nodes) =>
    nodes
      .filter((n) => n.ref.kind === 'object')
      .map((n) => {
        const ref = n.ref as Extract<TreeNodeRef, { kind: 'object' }>;
        return {
          name: ref.name,
          schema: ref.schema,
          database: ref.database,
          kind: ref.objectKind,
          detail: n.secondary,
        };
      }),
  );
}

/** Esquemas de la base (vacío en MariaDB y SQLite, donde no hay nivel esquema). */
export async function schemasOf(scope: CatalogScope): Promise<string[]> {
  if (scope.engine === 'mariadb' || scope.engine === 'sqlite') return [];
  const nodes = await children(scope.connectionId, { kind: 'database', database: scope.database });
  return nodes.flatMap((n) => (n.ref.kind === 'schema' ? [n.ref.schema] : []));
}

/** Columnas de una tabla o vista. */
export async function columnsOf(scope: CatalogScope, object: CatalogObject): Promise<CatalogColumn[]> {
  const ref: TreeNodeRef = {
    kind: 'object',
    database: object.database,
    schema: object.schema,
    objectKind: object.kind,
    name: object.name,
  };
  const nodes = await children(scope.connectionId, ref);
  return nodes.flatMap((n) =>
    n.ref.kind === 'column'
      ? [
          {
            name: n.label,
            nativeType: n.column?.nativeType ?? n.secondary ?? '',
            nullable: n.column?.nullable ?? true,
            primaryKey: !!n.primaryKey,
            defaultValue: n.column?.defaultValue,
            comment: n.column?.comment,
          },
        ]
      : [],
  );
}

/** Busca una tabla mencionada (con o sin esquema; sin distinguir mayúsculas). */
export async function resolveTable(
  scope: CatalogScope,
  mention: Pick<TableMention, 'schema' | 'name'>,
): Promise<CatalogObject | undefined> {
  const schemas = mention.schema ? [mention.schema] : scope.schemas;
  for (const schema of schemas) {
    const objects = await objectsOf(scope, schema);
    const exact = objects.find((o) => o.name === mention.name);
    const found = exact ?? objects.find((o) => o.name.toLowerCase() === mention.name.toLowerCase());
    if (found) return found;
  }
  return undefined;
}

/** Claves de la ruta del árbol hasta un objeto (para mostrarlo con F12 o Ctrl+P). */
export function objectPath(connectionId: string, engine: Engine, object: CatalogObject): string[] {
  const refs: TreeNodeRef[] = [{ kind: 'connection' }];
  if (engine !== 'sqlite') refs.push({ kind: 'database', database: object.database });
  if (engine === 'postgres' || engine === 'sqlserver') {
    refs.push({ kind: 'schema', database: object.database, schema: object.schema });
  }
  refs.push({
    kind: 'objectFolder',
    database: object.database,
    schema: object.schema,
    objectKind: object.kind,
  });
  refs.push({
    kind: 'object',
    database: object.database,
    schema: object.schema,
    objectKind: object.kind,
    name: object.name,
  });
  return refs.map((ref) => nodeKey(connectionId, ref));
}

/**
 * Muestra un objeto en el árbol de conexiones (F12 y Ctrl+P). La pestaña de
 * objeto llega en M7; mientras tanto se selecciona en el árbol.
 */
export function revealObject(connectionId: string, object: CatalogObject): void {
  const engine = connectionById(connectionId)?.engine;
  if (!engine) return;
  useUiStore.getState().showView('connections');
  store().reveal(connectionId, objectPath(connectionId, engine, object));
}

/**
 * Precarga las tablas y vistas del esquema de la pestaña activa al conectar o
 * cambiar de base/esquema, para que el autocompletado y Ctrl+P respondan al
 * instante (specs/05: catálogo cargado en segundo plano).
 */
export function startCatalogPreload(scopeOfActiveTab: () => CatalogScope | null): () => void {
  let last = '';
  const check = (): void => {
    const scope = scopeOfActiveTab();
    const key = scope ? `${scope.connectionId}|${scope.database}|${scope.schemas.join(',')}` : '';
    if (!scope || key === last) return;
    last = key;
    for (const schema of scope.schemas) void objectsOf(scope, schema).catch(() => undefined);
  };
  const a = useConnectionsStore.subscribe(check);
  const b = useWorkbenchStore.subscribe(check);
  check();
  return () => {
    a();
    b();
  };
}

/** Objetos ya cargados en la caché de todas las conexiones abiertas (Ctrl+P, specs/04 §13). */
export function cachedObjects(): { connectionId: string; object: CatalogObject }[] {
  const { children: all, status } = store();
  const out: { connectionId: string; object: CatalogObject }[] = [];
  for (const [key, nodes] of Object.entries(all)) {
    // Las claves de nodo empiezan con `c:<id de la conexión>` (ver `nodeKey`).
    const id = /^c:([^/]+)/.exec(key)?.[1];
    const connectionId = id ? decodeURIComponent(id) : '';
    if (!connectionId || status[connectionId]?.state !== 'connected') continue;
    for (const n of nodes) {
      if (n.ref.kind !== 'object') continue;
      const ref = n.ref;
      if (!['table', 'view', 'materializedView', 'function', 'procedure'].includes(ref.objectKind)) continue;
      out.push({
        connectionId,
        object: {
          name: ref.name,
          schema: ref.schema,
          database: ref.database,
          kind: ref.objectKind,
          detail: n.secondary,
        },
      });
    }
  }
  return out;
}
