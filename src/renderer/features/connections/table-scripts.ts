import type { Engine } from '@shared/connection';
import type { TreeNodeRef } from '@shared/metadata';
import { nodeKey } from '@shared/metadata';
import { qualifiedName, quoteIdent } from '@shared/sql-quote';
import { es } from '../../i18n/es';
import type { TreeTarget } from '../../stores/connections-store';
import { connectionById, useConnectionsStore } from '../../stores/connections-store';
import { showToast } from '../../stores/toast-store';
import { newScript } from '../editor/scripts';
import type { ObjectRefData } from '../objects/object-details';
import { fetchDdl } from '../objects/object-tabs';

type ObjectNodeRef = Extract<TreeNodeRef, { kind: 'object' }>;

/** Conexión, base y esquema de un nodo del árbol (destino de "Nuevo script"). */
export function targetOfRef(connectionId: string, ref: TreeNodeRef | null): TreeTarget {
  if (!ref || ref.kind === 'connection') return { connectionId };
  return {
    connectionId,
    database: ref.database,
    schema: 'schema' in ref ? ref.schema : undefined,
  };
}

/** Límite del SELECT generado desde el árbol (specs/04 §6). */
const SELECT_LIMIT = 500;

export function selectSql(engine: Engine, ref: ObjectNodeRef): string {
  const table = qualifiedName(engine, { schema: ref.schema, name: ref.name });
  return engine === 'sqlserver'
    ? `SELECT TOP ${SELECT_LIMIT} * FROM ${table};`
    : `SELECT * FROM ${table} LIMIT ${SELECT_LIMIT};`;
}

async function columnsOf(connectionId: string, ref: ObjectNodeRef): Promise<{ name: string; pk: boolean }[]> {
  const store = useConnectionsStore.getState();
  await store.loadChildren(connectionId, ref);
  return (useConnectionsStore.getState().children[nodeKey(connectionId, ref)] ?? [])
    .filter((n) => n.ref.kind === 'column')
    .map((n) => ({ name: n.label, pk: !!n.primaryKey }));
}

export type TableScriptKind = 'select' | 'insert' | 'update' | 'delete';

/** Crea un script con una sentencia de ejemplo para la tabla (menú "Nuevo script ▸"). */
export async function newTableScript(
  connectionId: string,
  ref: ObjectNodeRef,
  kind: TableScriptKind,
): Promise<void> {
  const engine = connectionById(connectionId)?.engine ?? 'postgres';
  const target = targetOfRef(connectionId, ref);
  if (kind === 'select') {
    await newScript(target, `${selectSql(engine, ref)}\r\n`);
    return;
  }
  const table = qualifiedName(engine, { schema: ref.schema, name: ref.name });
  const columns = await columnsOf(connectionId, ref);
  const q = (name: string): string => quoteIdent(engine, name);
  const keys = columns.filter((c) => c.pk);
  const where = (keys.length > 0 ? keys : columns.slice(0, 1))
    .map((c) => `${q(c.name)} = NULL`)
    .join(' AND ');
  let sql: string;
  if (kind === 'insert') {
    sql = `INSERT INTO ${table}\r\n  (${columns.map((c) => q(c.name)).join(', ')})\r\nVALUES\r\n  (${columns.map(() => 'NULL').join(', ')});`;
  } else if (kind === 'update') {
    const set = columns.filter((c) => !c.pk).map((c) => `${q(c.name)} = NULL`);
    sql = `UPDATE ${table}\r\nSET ${set.join(',\r\n    ')}\r\nWHERE ${where};`;
  } else {
    sql = `DELETE FROM ${table}\r\nWHERE ${where};`;
  }
  await newScript(target, `${sql}\r\n`);
}

/** "Contar filas": `SELECT count(*)` en la conexión de metadatos; el resultado va a un aviso. */
export async function countRows(connectionId: string, ref: ObjectNodeRef): Promise<void> {
  const r = await window.api.meta.count({
    connectionId,
    database: ref.database,
    schema: ref.schema,
    name: ref.name,
  });
  if (r.ok) showToast('info', es.tree.countResult(ref.name, r.data.count));
  else showToast('error', r.error.message);
}

/** Objeto del árbol como lo identifica la pestaña de objeto. */
export function objectRef(ref: ObjectNodeRef): ObjectRefData {
  return { database: ref.database, schema: ref.schema, name: ref.name, kind: ref.objectKind };
}

/** "Nuevo script ▸ DDL": un script con la sentencia de creación del objeto. */
export async function newDdlScript(connectionId: string, ref: ObjectNodeRef): Promise<void> {
  try {
    const ddl = await fetchDdl(connectionId, objectRef(ref));
    await newScript(targetOfRef(connectionId, ref), `${ddl}\r\n`);
  } catch (err) {
    showToast('error', err instanceof Error ? err.message : String(err));
  }
}
