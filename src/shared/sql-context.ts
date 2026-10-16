import { tokenize } from './splitter';
import type { SqlDialect, Token } from './splitter';

/**
 * Contexto de autocompletado (specs/05 §Autocompletado): análisis ligero por
 * tokens de la sentencia donde está el cursor, sin parser completo.
 */

/** Tabla mencionada en la sentencia (`FROM esquema.tabla AS t`). */
export interface TableMention {
  schema?: string;
  name: string;
  alias?: string;
}

export type CompletionKind =
  /** Después de FROM, JOIN, UPDATE, INTO, TABLE: tablas, vistas y esquemas. */
  | 'tables'
  /** En SELECT, WHERE, ON, GROUP BY, ORDER BY, SET, HAVING: columnas de las tablas presentes. */
  | 'columns'
  /** Después de `algo.`: columnas de un alias o tabla, u objetos de un esquema. */
  | 'members'
  /** Cualquier otro lugar: palabras clave, funciones y snippets. */
  | 'general';

export interface CompletionContext {
  kind: CompletionKind;
  /** Identificadores antes del punto (`['c']`, `['dbx']`, `['dbx', 't']`), sin comillas. */
  qualifier: string[];
  /** Lo ya escrito de la palabra actual (puede empezar con comilla). */
  prefix: string;
  /** Tablas de la sentencia, con su alias. */
  tables: TableMention[];
  /** CTE y tablas derivadas de la sentencia, con sus columnas. */
  derived: DerivedRelation[];
}

const TABLE_KEYWORDS = new Set(['from', 'join', 'update', 'into', 'table']);
const COLUMN_CLAUSES = new Set([
  'select',
  'where',
  'on',
  'by',
  'set',
  'having',
  'and',
  'or',
  'when',
  'then',
  'else',
]);

/** Palabras que terminan la lista de tablas de un FROM. */
const END_FROM = new Set([
  'where',
  'group',
  'order',
  'having',
  'limit',
  'offset',
  'union',
  'except',
  'intersect',
  'select',
  'on',
  'using',
  'set',
  'values',
  'returning',
  'window',
  'fetch',
]);

/** Palabras que terminan una referencia a tabla (no son alias). */
const NOT_ALIAS = new Set([
  'where',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'outer',
  'cross',
  'natural',
  'on',
  'using',
  'group',
  'order',
  'having',
  'limit',
  'offset',
  'union',
  'except',
  'intersect',
  'set',
  'values',
  'select',
  'returning',
  'window',
  'fetch',
  'for',
  'with',
  'lateral',
  'as',
  'when',
  'then',
  'top',
  'output',
  'into',
  'default',
]);

/** Texto de un identificador sin comillas (`"X"`, `` `x` ``, `[x]`). */
export function unquote(text: string): string {
  const first = text[0];
  if (first === '"' || first === '`')
    return text.slice(1, text.endsWith(first) ? -1 : undefined).replace(first + first, first);
  if (first === '[') return text.slice(1, text.endsWith(']') ? -1 : undefined).replace(/]]/g, ']');
  return text;
}

function isIdentifier(sql: string, t: Token | undefined): boolean {
  if (!t) return false;
  if (t.kind === 'word') return true;
  const c = sql[t.start];
  return t.kind === 'other' && (c === '"' || c === '`' || c === '[');
}

function identText(sql: string, t: Token): string {
  return unquote(sql.slice(t.start, t.end));
}

/** Tablas mencionadas: después de FROM/JOIN/UPDATE/INTO (también listas con coma tras FROM). */
export function tableMentions(sql: string, dialect: SqlDialect): TableMention[] {
  const tokens = tokenize(sql, dialect);
  const mentions: TableMention[] = [];
  let inFrom = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const word = t.kind === 'word' ? t.value : '';
    const startsRef = TABLE_KEYWORDS.has(word) || (inFrom && t.value === ',');
    if (word === 'from') inFrom = true;
    else if (END_FROM.has(word)) inFrom = false;
    if (!startsRef) continue;
    // [esquema.]nombre
    let j = i + 1;
    if (!isIdentifier(sql, tokens[j]) || (tokens[j]!.kind === 'word' && NOT_ALIAS.has(tokens[j]!.value)))
      continue;
    const parts = [identText(sql, tokens[j]!)];
    while (tokens[j + 1]?.value === '.' && isIdentifier(sql, tokens[j + 2])) {
      parts.push(identText(sql, tokens[j + 2]!));
      j += 2;
    }
    // [AS] alias
    let k = j + 1;
    if (tokens[k]?.kind === 'word' && tokens[k]!.value === 'as') k++;
    const next = tokens[k];
    const alias =
      next && isIdentifier(sql, next) && !(next.kind === 'word' && NOT_ALIAS.has(next.value))
        ? identText(sql, next)
        : undefined;
    const name = parts[parts.length - 1]!;
    const schema = parts.length >= 2 ? parts[parts.length - 2] : undefined;
    mentions.push({ schema, name, alias });
    i = alias ? k : j;
  }
  return mentions;
}

/**
 * Palabra que se está escribiendo al final de `before`. Incluye una comilla
 * de apertura sin cerrar (`"CRe`); una comilla de cierre (`"c"`) no cuenta.
 */
function currentWord(before: string): string {
  const quoted = /(["`[])([^"`\]]*)$/.exec(before);
  if (quoted) {
    const quote = quoted[1]!;
    const upTo = before.slice(0, quoted.index);
    // Abre un nombre si antes hay una cantidad par de esa comilla (o, con corchetes, ninguno abierto).
    const opens =
      quote === '['
        ? upTo.lastIndexOf('[') <= upTo.lastIndexOf(']')
        : (upTo.split(quote).length - 1) % 2 === 0;
    if (opens) return quoted[0];
  }
  return /[\p{L}\p{N}_$#@]*$/u.exec(before)?.[0] ?? '';
}

/**
 * Contexto del cursor en `offset` dentro de `sql` (el texto de la sentencia).
 */
export function completionContext(sql: string, offset: number, dialect: SqlDialect): CompletionContext {
  const before = sql.slice(0, offset);
  const tables = tableMentions(sql, dialect);
  const derived = derivedRelations(sql, dialect);
  // Palabra en curso, incluida una comilla de apertura sin cerrar.
  const prefix = currentWord(before);
  const head = before.slice(0, before.length - prefix.length);

  if (head.endsWith('.')) {
    const tokens = tokenize(head.slice(0, -1), dialect);
    const qualifier: string[] = [];
    let i = tokens.length - 1;
    while (i >= 0 && isIdentifier(head, tokens[i])) {
      qualifier.unshift(identText(head, tokens[i]!));
      if (tokens[i - 1]?.value !== '.') break;
      i -= 2;
    }
    if (qualifier.length > 0) return { kind: 'members', qualifier, prefix, tables, derived };
  }

  const tokens = tokenize(head, dialect);
  const last = tokens[tokens.length - 1];
  if (last?.kind === 'word' && TABLE_KEYWORDS.has(last.value))
    return { kind: 'tables', qualifier: [], prefix, tables, derived };
  // Última palabra clave de cláusula antes del cursor (al mismo nivel o dentro de paréntesis).
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!;
    if (t.kind !== 'word') continue;
    if (t.value === 'from' || t.value === 'join') {
      // En la lista de FROM (después de una coma) se siguen pidiendo tablas.
      return { kind: last?.value === ',' ? 'tables' : 'general', qualifier: [], prefix, tables, derived };
    }
    if (COLUMN_CLAUSES.has(t.value)) return { kind: 'columns', qualifier: [], prefix, tables, derived };
  }
  return { kind: 'general', qualifier: [], prefix, tables, derived };
}

/**
 * Relación definida dentro de la propia sentencia: un CTE (`WITH x AS (…)`) o una tabla derivada
 * (`FROM (SELECT …) alias`). Sus columnas salen de la lista del SELECT de su cuerpo.
 */
export interface DerivedRelation {
  /** Nombre del CTE o alias de la tabla derivada. */
  name: string;
  kind: 'cte' | 'derived';
  /** Columnas en orden: nombres propios (alias, columna simple, lista del CTE) y `*` por expandir. */
  items: DerivedItem[];
  /** Tablas mencionadas en el cuerpo (para expandir `*`). */
  sources: TableMention[];
}

export type DerivedItem = { name: string } | { star: { qualifier?: string } };

/** Palabras que cierran la lista de columnas de un SELECT. */
const END_SELECT_LIST = new Set([
  'from',
  'into',
  'where',
  'group',
  'order',
  'having',
  'limit',
  'offset',
  'union',
  'except',
  'intersect',
  'window',
  'fetch',
  'for',
]);

/** Palabras que, al final de una expresión, no son su alias (`CASE … END`, `x IS NULL`, `ORDER BY a DESC`). */
const NOT_A_NAME = new Set(['end', 'null', 'true', 'false', 'unknown', 'desc', 'asc', 'distinct']);

/** Índice de cada `(` → el de su `)`; los que no cierran no figuran (texto a medio escribir). */
function parenPairs(tokens: Token[]): Map<number, number> {
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  tokens.forEach((t, i) => {
    if (t.kind !== 'other') return;
    if (t.value === '(') stack.push(i);
    else if (t.value === ')' && stack.length > 0) pairs.set(stack.pop()!, i);
  });
  return pairs;
}

/** Columnas de la lista del primer SELECT de nivel superior entre `open` y `close` (exclusivos). */
function selectListItems(
  sql: string,
  tokens: Token[],
  open: number,
  close: number,
  pairs: Map<number, number>,
): DerivedItem[] {
  // Primer SELECT de nivel superior del cuerpo (puede haber un WITH propio antes).
  let i = open + 1;
  while (i < close && !(tokens[i]!.kind === 'word' && tokens[i]!.value === 'select')) {
    i = tokens[i]!.value === '(' && pairs.has(i) ? pairs.get(i)! + 1 : i + 1;
  }
  if (i >= close) return [];
  i++;
  // DISTINCT / ALL / TOP n [PERCENT] [WITH TIES]
  for (;;) {
    const t = tokens[i];
    if (!t || i >= close) return [];
    if (t.kind === 'word' && (t.value === 'distinct' || t.value === 'all')) {
      i++;
    } else if (t.kind === 'word' && t.value === 'top') {
      i++;
      if (tokens[i]?.value === '(' && pairs.has(i)) i = pairs.get(i)! + 1;
      else while (/^[\d.]$/.test(tokens[i]?.value ?? '')) i++;
      if (tokens[i]?.value === 'percent') i++;
      if (tokens[i]?.value === 'with' && tokens[i + 1]?.value === 'ties') i += 2;
    } else {
      break;
    }
  }

  const items: DerivedItem[] = [];
  let from = i;
  const flush = (to: number): void => {
    const item = selectItem(sql, tokens, from, to);
    if (item) items.push(item);
  };
  for (; i < close; i++) {
    const t = tokens[i]!;
    if (t.kind === 'other' && t.value === '(' && pairs.has(i)) {
      i = pairs.get(i)!;
    } else if (t.kind === 'other' && t.value === ',') {
      flush(i);
      from = i + 1;
    } else if (t.kind === 'semicolon' || (t.kind === 'word' && END_SELECT_LIST.has(t.value))) {
      break;
    }
  }
  flush(Math.min(i, close));
  return items;
}

/** Una columna de la lista del SELECT: su nombre (alias o columna simple) o un `*`. */
function selectItem(sql: string, tokens: Token[], from: number, to: number): DerivedItem | null {
  // `expr AS alias`: el alias manda, también si la expresión lleva un cast.
  if (to - from >= 2 && tokens[to - 2]!.value === 'as' && isIdentifier(sql, tokens[to - 1])) {
    return { name: identText(sql, tokens[to - 1]!) };
  }
  let end = to;
  // `expr::tipo` (PostgreSQL): el nombre es el de la expresión.
  for (let i = from; i + 1 < end; i++) {
    if (tokens[i]!.value === ':' && tokens[i + 1]!.value === ':') {
      end = i;
      break;
    }
  }
  const length = end - from;
  if (length <= 0) return null;
  const last = tokens[end - 1]!;
  // `*` o `tabla.*`
  if (last.kind === 'other' && last.value === '*') {
    if (length === 1) return { star: {} };
    if (tokens[end - 2]!.value === '.' && length >= 3 && isIdentifier(sql, tokens[end - 3])) {
      return { star: { qualifier: identText(sql, tokens[end - 3]!) } };
    }
    return null; // multiplicación u otra expresión
  }
  if (!isIdentifier(sql, last) || (last.kind === 'word' && NOT_A_NAME.has(last.value))) return null;
  if (length === 1) return { name: identText(sql, last) };
  const before = tokens[end - 2]!;
  if (before.value === '.') return { name: identText(sql, last) }; // tabla.columna
  if (before.kind === 'word' && before.value === 'as') return { name: identText(sql, last) };
  // Alias implícito (`expr alias`): lo que precede debe ser el final de una expresión, no un operador.
  const endsExpression =
    before.kind === 'word' ||
    isIdentifier(sql, before) ||
    before.value === ')' ||
    /^[\d']$/.test(sql[before.start]!);
  return endsExpression ? { name: identText(sql, last) } : null;
}

/** CTE y tablas derivadas de la sentencia, con las columnas que expone cada una. */
export function derivedRelations(sql: string, dialect: SqlDialect): DerivedRelation[] {
  const tokens = tokenize(sql, dialect);
  const pairs = parenPairs(tokens);
  const relations: DerivedRelation[] = [];
  const bodySources = (open: number, close: number): TableMention[] =>
    tableMentions(sql.slice(tokens[open]!.end, tokens[close]?.start ?? sql.length), dialect);
  const closeOf = (open: number): number => pairs.get(open) ?? tokens.length;

  let inFrom = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === 'word') {
      if (t.value === 'from') inFrom = true;
      else if (END_FROM.has(t.value)) inFrom = false;
    }

    // WITH [RECURSIVE] nombre [(columnas)] AS [[NOT] MATERIALIZED] ( … ) [, …]
    if (t.kind === 'word' && t.value === 'with') {
      let j = i + 1;
      if (tokens[j]?.value === 'recursive') j++;
      while (isIdentifier(sql, tokens[j])) {
        const name = identText(sql, tokens[j]!);
        let k = j + 1;
        let columns: string[] | undefined;
        if (tokens[k]?.value === '(' && pairs.has(k)) {
          columns = [];
          for (let c = k + 1; c < pairs.get(k)!; c++) {
            if (isIdentifier(sql, tokens[c])) columns.push(identText(sql, tokens[c]!));
          }
          k = pairs.get(k)! + 1;
        }
        if (tokens[k]?.value !== 'as') break;
        k++;
        if (tokens[k]?.value === 'not') k++;
        if (tokens[k]?.value === 'materialized') k++;
        if (tokens[k]?.value !== '(') break;
        const close = closeOf(k);
        relations.push({
          name,
          kind: 'cte',
          items: columns ? columns.map((c) => ({ name: c })) : selectListItems(sql, tokens, k, close, pairs),
          sources: bodySources(k, close),
        });
        if (tokens[close + 1]?.value !== ',') break;
        j = close + 2;
      }
      continue;
    }

    // FROM / JOIN / , ( SELECT … ) [AS] alias
    if (t.kind === 'other' && t.value === '(') {
      const prev = tokens[i - 1];
      const startsRelation =
        (prev?.kind === 'word' && ['from', 'join', 'lateral', 'apply'].includes(prev.value)) ||
        (prev?.value === ',' && inFrom);
      const next = tokens[i + 1];
      if (!startsRelation || next?.kind !== 'word' || (next.value !== 'select' && next.value !== 'with')) {
        continue;
      }
      const close = closeOf(i);
      let k = close + 1;
      if (tokens[k]?.value === 'as') k++;
      const alias = tokens[k];
      if (!isIdentifier(sql, alias) || (alias!.kind === 'word' && NOT_ALIAS.has(alias!.value))) continue;
      relations.push({
        name: identText(sql, alias!),
        kind: 'derived',
        items: selectListItems(sql, tokens, i, close, pairs),
        sources: bodySources(i, close),
      });
    }
  }
  return relations;
}

/**
 * Cuerpo entre `$tag$ … $tag$` (PostgreSQL) que contiene `offset`: el texto de una función o un
 * `DO` es una cadena para el tokenizador, pero es SQL que se completa como cualquier otro. Si la
 * etiqueta de cierre aún no está escrita, el cuerpo llega hasta el final.
 */
export function dollarBodyAt(sql: string, offset: number): { start: number; end: number } | null {
  const tag = /\$(?:[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*)?\$/g;
  let from = 0;
  for (;;) {
    tag.lastIndex = from;
    const open = tag.exec(sql);
    if (!open) return null;
    // `$1` y similares son parámetros, no etiquetas: la etiqueta no puede seguir a una palabra.
    if (open.index > 0 && /[A-Za-z0-9_]/.test(sql[open.index - 1]!)) {
      from = open.index + 1;
      continue;
    }
    const start = open.index + open[0].length;
    const close = sql.indexOf(open[0], start);
    const end = close < 0 ? sql.length : close;
    if (offset >= start && offset <= end) return { start, end };
    if (close < 0) return null;
    from = close + open[0].length;
  }
}
