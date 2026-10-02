import type { ConnectionConfig } from '@shared/connection';
import type { ObjectKind, TreeNodeData, TreeNodeRef } from '@shared/metadata';
import type { DbDriver } from './drivers/types';

/** Orden de las carpetas de un esquema en el árbol. */
const FOLDER_ORDER: ObjectKind[] = ['table', 'view', 'materializedView', 'function', 'procedure', 'sequence'];

function supportsKind(driver: DbDriver, kind: ObjectKind): boolean {
  const c = driver.capabilities;
  switch (kind) {
    case 'materializedView':
      return c.materializedViews;
    case 'function':
      return c.functions;
    case 'procedure':
      return c.procedures;
    case 'sequence':
      return c.sequences;
    case 'trigger':
      return c.triggers;
    default:
      return true;
  }
}

const HAS_COLUMNS: ObjectKind[] = ['table', 'view', 'materializedView'];

/**
 * Hijos de un nodo del árbol, genérico para todos los motores según sus
 * `capabilities`. Las etiquetas de carpetas las pone el renderer (i18n).
 */
export async function childrenOf(
  driver: DbDriver,
  config: ConnectionConfig,
  ref: TreeNodeRef,
): Promise<TreeNodeData[]> {
  const caps = driver.capabilities;
  switch (ref.kind) {
    case 'connection': {
      if (!caps.databases) return schemaLevel(driver, config, 'main');
      const dbs = await driver.listDatabases();
      return dbs
        .filter((d) => config.showSystemObjects || !d.system)
        .map((d) => ({
          ref: { kind: 'database', database: d.name },
          label: d.name,
          secondary: d.detail,
          expandable: true,
        }));
    }
    case 'database':
      return schemaLevel(driver, config, ref.database);
    case 'systemSchemas': {
      const schemas = await driver.listSchemas(ref.database);
      return schemas
        .filter((s) => s.system)
        .map((s) => ({
          ref: { kind: 'schema', database: ref.database, schema: s.name },
          label: s.name,
          expandable: true,
        }));
    }
    case 'schema': {
      const counts = await driver.countObjects({ database: ref.database, schema: ref.schema });
      return FOLDER_ORDER.filter((k) => supportsKind(driver, k)).map((objectKind) => ({
        ref: { kind: 'objectFolder', database: ref.database, schema: ref.schema, objectKind },
        label: '',
        count: counts[objectKind] ?? 0,
        expandable: true,
      }));
    }
    case 'objectFolder': {
      const objects = await driver.listObjects(
        { database: ref.database, schema: ref.schema },
        ref.objectKind,
      );
      return objects.map((o) => ({
        ref: {
          kind: 'object',
          database: ref.database,
          schema: ref.schema,
          objectKind: ref.objectKind,
          name: o.name,
        },
        label: o.name,
        secondary: o.detail,
        expandable: HAS_COLUMNS.includes(ref.objectKind),
      }));
    }
    case 'object': {
      if (!HAS_COLUMNS.includes(ref.objectKind)) return [];
      const target = { database: ref.database, schema: ref.schema, name: ref.name };
      const columns = await driver.getColumns(target);
      const nodes: TreeNodeData[] = columns.map((c) => ({
        ref: { kind: 'column', database: ref.database, schema: ref.schema, table: ref.name, name: c.name },
        label: c.name,
        secondary: c.nullable ? c.nativeType : `${c.nativeType} · NOT NULL`,
        primaryKey: c.primaryKey,
        column: {
          nativeType: c.nativeType,
          nullable: c.nullable,
          defaultValue: c.defaultValue,
          comment: c.comment,
        },
        expandable: false,
      }));
      if (ref.objectKind !== 'view') {
        const indexes = await driver.getIndexes(target);
        nodes.push({
          ref: { kind: 'indexFolder', database: ref.database, schema: ref.schema, table: ref.name },
          label: '',
          count: indexes.length,
          expandable: indexes.length > 0,
        });
      }
      return nodes;
    }
    case 'indexFolder': {
      const indexes = await driver.getIndexes({
        database: ref.database,
        schema: ref.schema,
        name: ref.table,
      });
      return indexes.map((i) => ({
        ref: { kind: 'index', database: ref.database, schema: ref.schema, table: ref.table, name: i.name },
        label: i.name,
        secondary: i.columns.join(', '),
        primaryKey: i.primary,
        expandable: false,
      }));
    }
    case 'column':
    case 'index':
      return [];
  }
}

/** Nivel de esquemas de una base (o directamente las carpetas si el motor no tiene esquemas). */
async function schemaLevel(
  driver: DbDriver,
  config: ConnectionConfig,
  database: string,
): Promise<TreeNodeData[]> {
  if (!driver.capabilities.schemas) {
    return childrenOf(driver, config, { kind: 'schema', database, schema: database });
  }
  const schemas = await driver.listSchemas(database);
  const nodes: TreeNodeData[] = schemas
    .filter((s) => !s.system)
    .map((s) => ({ ref: { kind: 'schema', database, schema: s.name }, label: s.name, expandable: true }));
  if (schemas.some((s) => s.system)) {
    nodes.push({ ref: { kind: 'systemSchemas', database }, label: '', expandable: true });
  }
  return nodes;
}
