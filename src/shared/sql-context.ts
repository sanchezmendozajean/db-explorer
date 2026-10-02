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
    if (qualifier.length > 0) return { kind: 'members', qualifier, prefix, tables };
  }

  const tokens = tokenize(head, dialect);
  const last = tokens[tokens.length - 1];
  if (last?.kind === 'word' && TABLE_KEYWORDS.has(last.value))
    return { kind: 'tables', qualifier: [], prefix, tables };
  // Última palabra clave de cláusula antes del cursor (al mismo nivel o dentro de paréntesis).
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!;
    if (t.kind !== 'word') continue;
    if (t.value === 'from' || t.value === 'join') {
      // En la lista de FROM (después de una coma) se siguen pidiendo tablas.
      return { kind: last?.value === ',' ? 'tables' : 'general', qualifier: [], prefix, tables };
    }
    if (COLUMN_CLAUSES.has(t.value)) return { kind: 'columns', qualifier: [], prefix, tables };
  }
  return { kind: 'general', qualifier: [], prefix, tables };
}
