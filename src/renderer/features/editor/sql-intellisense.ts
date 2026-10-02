import type * as MonacoApi from 'monaco-editor/editor/editor.api';
import type { Engine } from '@shared/connection';
import { completionContext } from '@shared/sql-context';
import type { CompletionContext, TableMention } from '@shared/sql-context';
import { functionsFor, keywordsFor, SQL_SNIPPETS } from '@shared/sql-keywords';
import { quoteIdent } from '@shared/sql-quote';
import { splitStatements, statementAt } from '@shared/splitter';
import { es } from '../../i18n/es';
import { setting } from '../../stores/settings-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import { catalogScope, columnsOf, objectsOf, resolveTable, schemasOf } from './catalog';
import type { CatalogColumn, CatalogObject, CatalogScope } from './catalog';
import { effectiveTarget } from './target-pickers';
import type { Monaco } from './monaco/loader';

/**
 * Autocompletado, hover y F12 de SQL (specs/05): contexto por tokens
 * (`completionContext`) + catálogo de la caché del árbol (`catalog.ts`).
 */

type Model = MonacoApi.editor.ITextModel;
type Position = MonacoApi.Position;

/** Datos propios que viajan en un ítem para completarlo después (`resolveCompletionItem`). */
interface ItemData {
  scope: CatalogScope;
  object: CatalogObject;
}
export type DbCompletionItem = MonacoApi.languages.CompletionItem & { dbx?: ItemData };

export interface EditorSqlContext {
  engine?: Engine;
  scope: CatalogScope | null;
  /** Texto de la sentencia del cursor y posición relativa. */
  statement: string;
  offset: number;
}

/** Sentencia del cursor y ámbito del catálogo para un modelo (pestaña, conexión, base y esquema). */
export function sqlContextAt(model: Model, position: Position, tabId: string | undefined): EditorSqlContext {
  const tab = useWorkbenchStore.getState().tabs.find((t) => t.id === tabId);
  const target = effectiveTarget(tab);
  const scope = catalogScope(tab?.connectionId, target.database, target.schema);
  const engine = scope?.engine;
  const text = model.getValue();
  const offset = model.getOffsetAt(position);
  const statements = splitStatements(text, engine ?? 'generic', {
    blankLineSeparator: setting('sql.statementSeparator') === 'blankLine',
  });
  const s = statementAt(text, statements, offset);
  if (!s || offset < s.start) return { engine, scope, statement: text, offset };
  const end = Math.max(s.start + s.text.length, offset);
  return { engine, scope, statement: text.slice(s.start, end), offset: offset - s.start };
}

function eq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Tabla de la sentencia a la que se refiere un calificador (alias o nombre). */
function mentionFor(name: string, tables: TableMention[]): TableMention | undefined {
  return tables.find((t) => t.alias && eq(t.alias, name)) ?? tables.find((t) => eq(t.name, name));
}

/** Resuelve el calificador de `algo.`: columnas de una tabla u objetos de un esquema. */
async function members(
  scope: CatalogScope,
  c: CompletionContext,
): Promise<{ table?: CatalogObject; columns?: CatalogColumn[]; schemaObjects?: CatalogObject[] }> {
  const q = c.qualifier.slice(-2);
  if (q.length === 2) {
    const table = await resolveTable(scope, { schema: q[0]!, name: q[1]! });
    return table ? { table, columns: await columnsOf(scope, table) } : {};
  }
  const name = q[0]!;
  const mention = mentionFor(name, c.tables);
  if (mention) {
    const table = await resolveTable(scope, mention);
    if (table) return { table, columns: await columnsOf(scope, table) };
  }
  const schemas = await schemasOf(scope);
  const schema = schemas.find((s) => eq(s, name));
  if (schema) return { schemaObjects: await objectsOf(scope, schema) };
  const table = await resolveTable(scope, { name });
  return table ? { table, columns: await columnsOf(scope, table) } : {};
}

function kindLabel(kind: string): string {
  return es.editor.objectKinds[kind as keyof typeof es.editor.objectKinds] ?? kind;
}

/** Ítems de autocompletado para la posición del cursor. */
export async function completionItems(
  monaco: Monaco,
  model: Model,
  position: Position,
  tabId: string | undefined,
): Promise<DbCompletionItem[]> {
  const { engine, scope, statement, offset } = sqlContextAt(model, position, tabId);
  const c = completionContext(statement, offset, engine ?? 'generic');
  const range = new monaco.Range(
    position.lineNumber,
    position.column - c.prefix.length,
    position.lineNumber,
    position.column,
  );
  const K = monaco.languages.CompletionItemKind;
  const quote = (name: string): string => (engine ? quoteIdent(engine, name) : name);
  const quoted = /^["`[]/.test(c.prefix);
  const items: DbCompletionItem[] = [];

  const column = (col: CatalogColumn, table: CatalogObject): DbCompletionItem => ({
    label: { label: col.name, description: table.name },
    kind: K.Field,
    detail: `${col.nativeType}${col.primaryKey ? ' · PK' : ''}`,
    documentation: col.comment,
    insertText: quote(col.name),
    filterText: quoted ? quote(col.name) : col.name,
    sortText: `0${col.name}`,
    range,
  });
  const object = (o: CatalogObject): DbCompletionItem => ({
    label: { label: o.name, description: o.schema },
    kind: o.kind === 'table' ? K.Struct : K.Interface,
    detail: kindLabel(o.kind),
    insertText: quote(o.name),
    filterText: quoted ? quote(o.name) : o.name,
    sortText: `1${o.name}`,
    range,
    dbx: scope ? { scope, object: o } : undefined,
  });

  if (scope && c.kind === 'members') {
    const r = await members(scope, c);
    if (r.columns && r.table) items.push(...r.columns.map((col) => column(col, r.table!)));
    if (r.schemaObjects) items.push(...r.schemaObjects.map(object));
    return items;
  }
  if (scope && c.kind === 'tables') {
    for (const schema of scope.schemas) items.push(...(await objectsOf(scope, schema)).map(object));
    for (const schema of await schemasOf(scope)) {
      // Elegir un esquema inserta `esquema.` y vuelve a abrir la lista con sus objetos.
      items.push({
        label: schema,
        kind: K.Module,
        detail: es.editor.objectKinds.schema,
        insertText: `${quote(schema)}.`,
        sortText: `2${schema}`,
        range,
        command: { id: 'editor.action.triggerSuggest', title: '' },
      });
    }
    return items;
  }
  if (scope && c.kind === 'columns') {
    for (const mention of c.tables) {
      const table = await resolveTable(scope, mention);
      if (table) items.push(...(await columnsOf(scope, table)).map((col) => column(col, table)));
    }
  }
  for (const fn of functionsFor(engine)) {
    items.push({
      label: fn,
      kind: K.Function,
      insertText: `${fn}($0)`,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      sortText: `3${fn}`,
      range,
    });
  }
  for (const kw of keywordsFor(engine)) {
    items.push({ label: kw, kind: K.Keyword, insertText: kw, sortText: `4${kw}`, range });
  }
  if (c.kind === 'general') {
    for (const s of SQL_SNIPPETS) {
      items.push({
        label: s.label,
        kind: K.Snippet,
        detail: s.detail,
        insertText: s.body,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        sortText: `5${s.label}`,
        range,
      });
    }
  }
  return items;
}

/** Documentación de una tabla en el autocompletado: sus columnas (se cargan al seleccionarla). */
export async function resolveItem(item: DbCompletionItem): Promise<DbCompletionItem> {
  if (!item.dbx) return item;
  const columns = await columnsOf(item.dbx.scope, item.dbx.object);
  return { ...item, documentation: { value: columnsMarkdown(columns) } };
}

function columnsMarkdown(columns: CatalogColumn[]): string {
  const shown = columns.slice(0, 60);
  const lines = shown.map((c) => `- \`${c.name}\` ${c.nativeType}${c.primaryKey ? ' · **PK**' : ''}`);
  if (columns.length > shown.length) lines.push(es.editor.moreColumns(columns.length - shown.length));
  return lines.join('\n');
}

/** Tabla o columna bajo el cursor (hover y F12). */
export async function symbolAt(
  model: Model,
  position: Position,
  tabId: string | undefined,
): Promise<{ scope: CatalogScope; table?: CatalogObject; column?: CatalogColumn } | null> {
  const word = model.getWordAtPosition(position);
  if (!word) return null;
  const end = { lineNumber: position.lineNumber, column: word.endColumn } as Position;
  const { engine, scope, statement, offset } = sqlContextAt(model, end, tabId);
  if (!scope) return null;
  const c = completionContext(statement, offset, engine ?? 'generic');
  const name = word.word;
  if (c.kind === 'members') {
    const r = await members(scope, c);
    if (r.table && r.columns) {
      const column = r.columns.find((col) => eq(col.name, name));
      if (column) return { scope, table: r.table, column };
    }
    if (r.schemaObjects) {
      const table = r.schemaObjects.find((o) => eq(o.name, name));
      if (table) return { scope, table };
    }
    return null;
  }
  const mention = c.tables.find((t) => eq(t.name, name) || (t.alias && eq(t.alias, name)));
  if (mention) {
    const table = await resolveTable(scope, mention);
    return table ? { scope, table } : null;
  }
  for (const t of c.tables) {
    const table = await resolveTable(scope, t);
    if (!table) continue;
    const column = (await columnsOf(scope, table)).find((col) => eq(col.name, name));
    if (column) return { scope, table, column };
  }
  const table = await resolveTable(scope, { name });
  return table ? { scope, table } : null;
}

/** Contenido del hover: tabla → columnas con tipos; columna → tipo, nulo, default (specs/05). */
export async function hoverMarkdown(
  model: Model,
  position: Position,
  tabId: string | undefined,
): Promise<string | null> {
  const symbol = await symbolAt(model, position, tabId);
  if (!symbol?.table) return null;
  const { table, column } = symbol;
  if (column) {
    const parts = [`\`${column.nativeType}\``, column.nullable ? 'NULL' : 'NOT NULL'];
    if (column.primaryKey) parts.push('PK');
    if (column.defaultValue) parts.push(`DEFAULT \`${column.defaultValue}\``);
    return [`**${table.name}.${column.name}**`, parts.join(' · '), column.comment ?? '']
      .filter(Boolean)
      .join('\n\n');
  }
  const columns = await columnsOf(symbol.scope, table);
  return `**${table.schema}.${table.name}** · ${kindLabel(table.kind)}\n\n${columnsMarkdown(columns)}`;
}
