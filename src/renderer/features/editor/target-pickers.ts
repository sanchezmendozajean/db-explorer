import { connectionAddress } from '@shared/connection';
import type { Engine } from '@shared/connection';
import type { TreeNodeRef } from '@shared/metadata';
import { nodeKey } from '@shared/metadata';
import { es } from '../../i18n/es';
import { connectionById, useConnectionsStore } from '../../stores/connections-store';
import { useOverlayStore } from '../../stores/overlay-store';
import type { PickAnchor, QuickPickItem } from '../../stores/overlay-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import type { EditorTab } from '../../stores/workbench-store';
import { ensureConnected } from '../connections/actions';
import { setTabTarget } from './scripts';

/**
 * El esquema se elige por sesión solo en PostgreSQL (`search_path`). En SQL
 * Server el esquema por defecto es del usuario y en MariaDB base y esquema son
 * lo mismo; en SQLite no hay esquemas.
 */
export function hasSessionSchema(engine: Engine | undefined): boolean {
  return engine === 'postgres';
}

/** Base y esquema efectivos de una pestaña (los elegidos o los predeterminados de la conexión). */
export function effectiveTarget(tab: EditorTab | undefined): { database?: string; schema?: string } {
  if (!tab?.connectionId) return {};
  const conn = connectionById(tab.connectionId);
  const status = useConnectionsStore.getState().status[tab.connectionId];
  const server = status?.state === 'connected' ? status.server : undefined;
  const database = tab.database ?? server?.defaultDatabase ?? (conn?.database || undefined);
  const sameDb = !tab.database || tab.database === server?.defaultDatabase;
  const schema =
    tab.schema ??
    (sameDb ? server?.defaultSchema : undefined) ??
    (conn?.engine === 'postgres' ? 'public' : undefined);
  return { database, schema };
}

function tabById(tabId: string): EditorTab | undefined {
  return useWorkbenchStore.getState().tabs.find((t) => t.id === tabId);
}

async function childrenOf(connectionId: string, ref: TreeNodeRef): Promise<ReturnType<typeof readChildren>> {
  await useConnectionsStore.getState().loadChildren(connectionId, ref);
  return readChildren(connectionId, ref);
}

function readChildren(connectionId: string, ref: TreeNodeRef) {
  return useConnectionsStore.getState().children[nodeKey(connectionId, ref)] ?? [];
}

/** Ctrl+9 / chip de conexión: lista filtrable de conexiones (specs/04 §8). */
export function pickConnection(tabId: string, anchor?: PickAnchor): void {
  const tab = tabById(tabId);
  const items: QuickPickItem[] = useConnectionsStore.getState().connections.map((c) => ({
    id: c.id,
    label: c.name,
    icon: 'circle-filled',
    iconColor: c.color ?? `var(--env-${c.environment})`,
    detail: `${es.connections.engines[c.engine]} · ${connectionAddress(c)}`,
    current: c.id === tab?.connectionId,
    run: () => setTabTarget(tabId, { connectionId: c.id }),
  }));
  useOverlayStore.getState().openPick({ placeholder: es.pickers.connection, items, anchor });
}

async function databases(connectionId: string): Promise<string[]> {
  if (!(await ensureConnected(connectionId))) return [];
  const conn = connectionById(connectionId);
  if (conn && conn.engine === 'sqlite') return [];
  return (await childrenOf(connectionId, { kind: 'connection' }))
    .filter((n) => n.ref.kind === 'database')
    .map((n) => n.label);
}

async function schemas(connectionId: string, database: string): Promise<string[]> {
  const nodes = await childrenOf(connectionId, { kind: 'database', database });
  const result = nodes.filter((n) => n.ref.kind === 'schema').map((n) => n.label);
  // Los esquemas del sistema quedan al final (van agrupados en el árbol).
  if (nodes.some((n) => n.ref.kind === 'systemSchemas')) {
    const system = await childrenOf(connectionId, { kind: 'systemSchemas', database });
    result.push(...system.filter((n) => n.ref.kind === 'schema').map((n) => n.label));
  }
  return result;
}

/** Chip de base de datos. */
export async function pickDatabase(tabId: string, anchor?: PickAnchor): Promise<void> {
  const tab = tabById(tabId);
  if (!tab?.connectionId) return;
  const current = effectiveTarget(tab).database;
  const items = (await databases(tab.connectionId)).map((db) => ({
    id: db,
    label: db,
    icon: 'database',
    current: db === current,
    run: () => setTabTarget(tabId, { database: db, schema: undefined }),
  }));
  useOverlayStore.getState().openPick({ placeholder: es.pickers.database, items, anchor });
}

/** Chip de esquema. */
export async function pickSchema(tabId: string, anchor?: PickAnchor): Promise<void> {
  const tab = tabById(tabId);
  if (!tab?.connectionId) return;
  if (!(await ensureConnected(tab.connectionId))) return;
  const { database, schema } = effectiveTarget(tabById(tabId));
  if (!database) return;
  const items = (await schemas(tab.connectionId, database)).map((s) => ({
    id: s,
    label: s,
    icon: 'symbol-namespace',
    current: s === schema,
    run: () => setTabTarget(tabId, { database, schema: s }),
  }));
  useOverlayStore.getState().openPick({ placeholder: es.pickers.schema, items, anchor });
}

/** Ctrl+0: esquemas de la base actual y las demás bases, en una sola lista. */
export async function pickDatabaseOrSchema(tabId: string): Promise<void> {
  const tab = tabById(tabId);
  if (!tab?.connectionId) return;
  const connectionId = tab.connectionId;
  if (!(await ensureConnected(connectionId))) return;
  const { database, schema } = effectiveTarget(tabById(tabId));
  const items: QuickPickItem[] = [];
  if (database && hasSessionSchema(connectionById(connectionId)?.engine)) {
    for (const s of await schemas(connectionId, database)) {
      items.push({
        id: `s:${s}`,
        label: s,
        icon: 'symbol-namespace',
        detail: database,
        current: s === schema,
        run: () => setTabTarget(tabId, { database, schema: s }),
      });
    }
  }
  for (const db of await databases(connectionId)) {
    if (db === database) continue;
    items.push({
      id: `d:${db}`,
      label: db,
      icon: 'database',
      detail: es.pickers.otherDatabase,
      run: () => setTabTarget(tabId, { database: db, schema: undefined }),
    });
  }
  useOverlayStore.getState().openPick({ placeholder: es.pickers.databaseOrSchema, items });
}
