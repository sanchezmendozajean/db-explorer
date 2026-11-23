import type { DbObject, ObjectKind } from '@shared/metadata';
import { quoteIdent } from '@shared/sql-quote';
import type { DbDriver, ObjectRef, Scope } from './drivers/types';

/** Orden de creación: lo que no depende de nada primero; las vistas y rutinas al final. */
const KIND_ORDER: ObjectKind[] = ['sequence', 'table', 'view', 'materializedView', 'function', 'procedure'];

function supports(driver: DbDriver, kind: ObjectKind): boolean {
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
    default:
      return true;
  }
}

const message = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ');

/** Comentario de línea: los saltos del texto se aplanan para no escapar del comentario. */
const comment = (text: string): string => `-- ${text.replace(/\s+/g, ' ')}`;

/**
 * Ordena las tablas para que cada una se cree después de las que referencia por clave foránea.
 * Si hay ciclos, el orden queda como venía y se informa para que el usuario lo resuelva.
 */
async function sortTables(
  driver: DbDriver,
  tables: { scope: Scope; object: DbObject }[],
): Promise<{ ordered: typeof tables; cyclic: boolean }> {
  const keyOf = (schema: string, name: string): string => `${schema}\u0000${name}`;
  const byKey = new Map(tables.map((t) => [keyOf(t.scope.schema, t.object.name), t]));
  const deps = new Map<string, string[]>();
  for (const t of tables) {
    const ref: ObjectRef = { ...t.scope, name: t.object.name };
    const constraints = await driver.getConstraints(ref).catch(() => []);
    deps.set(
      keyOf(t.scope.schema, t.object.name),
      constraints
        .filter((c) => c.type === 'foreignKey' && c.references)
        .map((c) => keyOf(c.references!.schema || t.scope.schema, c.references!.table)),
    );
  }
  const ordered: typeof tables = [];
  const state = new Map<string, 'visiting' | 'done'>();
  let cyclic = false;
  const visit = (key: string): void => {
    const current = state.get(key);
    if (current === 'done') return;
    if (current === 'visiting') {
      cyclic = true;
      return;
    }
    state.set(key, 'visiting');
    for (const dep of deps.get(key) ?? []) if (dep !== key && byKey.has(dep)) visit(dep);
    state.set(key, 'done');
    ordered.push(byKey.get(key)!);
  };
  for (const key of byKey.keys()) visit(key);
  return { ordered, cyclic };
}

/**
 * Script de creación de toda la base: esquemas, secuencias, tablas (con índices y restricciones),
 * vistas y rutinas, cada uno con el DDL que da el driver. Un objeto que falla no detiene el script:
 * queda un comentario con el motivo.
 */
export async function databaseDdl(driver: DbDriver, database: string): Promise<string> {
  const engine = driver.engine;
  const sqlServer = driver.capabilities.batchSeparator === 'GO';
  const scopes: Scope[] = driver.capabilities.schemas
    ? (await driver.listSchemas(database)).filter((s) => !s.system).map((s) => ({ database, schema: s.name }))
    : [{ database, schema: database }];

  const found = new Map<ObjectKind, { scope: Scope; object: DbObject }[]>();
  for (const scope of scopes) {
    for (const kind of KIND_ORDER.filter((k) => supports(driver, k))) {
      const objects = await driver.listObjects(scope, kind);
      found.set(kind, [...(found.get(kind) ?? []), ...objects.map((object) => ({ scope, object }))]);
    }
  }

  const blocks: string[] = [comment(`DDL de la base de datos ${database}`)];
  const push = (sql: string): void => {
    blocks.push(sqlServer ? `${sql}\nGO` : sql);
  };

  // Los esquemas predeterminados ya existen; los demás hay que crearlos antes que sus objetos.
  if (driver.capabilities.schemas) {
    const builtin = engine === 'sqlserver' ? 'dbo' : 'public';
    for (const scope of scopes) {
      if (scope.schema === builtin) continue;
      const name = quoteIdent(engine, scope.schema);
      push(engine === 'postgres' ? `CREATE SCHEMA IF NOT EXISTS ${name};` : `CREATE SCHEMA ${name};`);
    }
  }

  for (const kind of KIND_ORDER) {
    let items = found.get(kind) ?? [];
    if (items.length === 0) continue;
    if (kind === 'table') {
      const { ordered, cyclic } = await sortTables(driver, items);
      items = ordered;
      if (cyclic) {
        blocks.push(
          comment(
            'Aviso: hay claves foráneas circulares entre tablas; puede ser necesario crear esas restricciones con ALTER TABLE.',
          ),
        );
      }
    }
    for (const { scope, object } of items) {
      const where = driver.capabilities.schemas ? `${scope.schema}.${object.name}` : object.name;
      try {
        const ddl = (await driver.getDDL({ ...scope, name: object.name }, kind)).trim();
        push(ddl ? (ddl.endsWith(';') || sqlServer ? ddl : `${ddl};`) : comment(`Sin DDL para ${where}`));
      } catch (err) {
        push(comment(`No se pudo obtener el DDL de ${where}: ${message(err)}`));
      }
    }
  }
  return `${blocks.join('\n\n')}\n`;
}
