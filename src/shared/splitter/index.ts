/**
 * Separación de sentencias SQL por dialecto (specs/03 §Separación de sentencias).
 * Módulo puro compartido: lo usa el renderer para la sentencia activa y la
 * ejecución, sin ir al proceso de BD.
 *
 * En M3 se cubre PostgreSQL por completo. Las comillas y comentarios de los
 * demás dialectos ya están contemplados; `DELIMITER` (MariaDB) y `GO`
 * (SQL Server) llegan en M4.
 */

export type SqlDialect = 'postgres' | 'mariadb' | 'sqlite' | 'sqlserver' | 'generic';

export interface Statement {
  /** Texto de la sentencia sin el `;` final. */
  text: string;
  /** Offset del primer carácter de código (se omiten espacios y comentarios previos). */
  start: number;
  /** Offset exclusivo del final; incluye el `;` si lo hay. */
  end: number;
  /** Posiciones 1-based estilo Monaco; `end*` apunta justo después del último carácter. */
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

interface DialectRules {
  /** `"…"` es identificador (true) o cadena con escapes `\` (false, MariaDB). */
  doubleQuoteIsIdentifier: boolean;
  backtickIdentifiers: boolean;
  bracketIdentifiers: boolean;
  /** `\` escapa dentro de `'…'` (MariaDB por defecto). */
  backslashEscapes: boolean;
  /** Comentarios de bloque anidables (PostgreSQL). */
  nestedComments: boolean;
  /** `$tag$ … $tag$` y `E'…'` de PostgreSQL. */
  postgres: boolean;
  /** `#` inicia comentario de línea (MariaDB). */
  hashComments: boolean;
}

const RULES: Record<SqlDialect, DialectRules> = {
  postgres: {
    doubleQuoteIsIdentifier: true,
    backtickIdentifiers: false,
    bracketIdentifiers: false,
    backslashEscapes: false,
    nestedComments: true,
    postgres: true,
    hashComments: false,
  },
  mariadb: {
    doubleQuoteIsIdentifier: false,
    backtickIdentifiers: true,
    bracketIdentifiers: false,
    backslashEscapes: true,
    nestedComments: false,
    postgres: false,
    hashComments: true,
  },
  sqlite: {
    doubleQuoteIsIdentifier: true,
    backtickIdentifiers: true,
    bracketIdentifiers: true,
    backslashEscapes: false,
    nestedComments: false,
    postgres: false,
    hashComments: false,
  },
  sqlserver: {
    doubleQuoteIsIdentifier: true,
    backtickIdentifiers: false,
    bracketIdentifiers: true,
    backslashEscapes: false,
    nestedComments: false,
    postgres: false,
    hashComments: false,
  },
  generic: {
    doubleQuoteIsIdentifier: true,
    backtickIdentifiers: false,
    bracketIdentifiers: false,
    backslashEscapes: false,
    nestedComments: false,
    postgres: false,
    hashComments: false,
  },
};

export interface Token {
  kind: 'word' | 'semicolon' | 'other';
  /** Palabra en minúsculas (solo `word`). */
  value: string;
  start: number;
  end: number;
}

const isWordStart = (c: string): boolean => /[A-Za-z_\u0080-￿]/.test(c);
const isWordChar = (c: string): boolean => /[A-Za-z0-9_$\u0080-￿]/.test(c);

/** Busca el fin de una cadena o identificador entre `quote`, con escape por duplicación y opcionalmente `\`. */
function skipQuoted(sql: string, from: number, quote: string, backslash: boolean): number {
  let i = from + 1;
  while (i < sql.length) {
    const c = sql[i]!;
    if (backslash && c === '\\') {
      i += 2;
      continue;
    }
    if (c === quote) {
      if (sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return sql.length;
}

/**
 * Recorre el texto y devuelve los tokens de código (palabras, `;` y el resto),
 * saltando comentarios. Cadenas e identificadores entre comillas cuentan como
 * un token `other` (no son palabras clave).
 */
export function tokenize(sql: string, dialect: SqlDialect = 'postgres'): Token[] {
  const rules = RULES[dialect];
  const tokens: Token[] = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') {
      i++;
      continue;
    }
    // Comentarios de línea.
    if ((c === '-' && next === '-') || (rules.hashComments && c === '#')) {
      const eol = sql.indexOf('\n', i);
      i = eol < 0 ? n : eol + 1;
      continue;
    }
    // Comentarios de bloque.
    if (c === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else if (rules.nestedComments && sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }
    const start = i;
    if (c === ';') {
      tokens.push({ kind: 'semicolon', value: ';', start, end: i + 1 });
      i++;
      continue;
    }
    if (c === "'") {
      // E'…' de PostgreSQL admite escapes con `\`.
      const prev = sql[i - 1];
      const escapeString =
        rules.postgres &&
        (prev === 'E' || prev === 'e') &&
        (i < 2 || !isWordChar(sql[i - 2]!)) &&
        tokens.length > 0 &&
        tokens[tokens.length - 1]!.end === i;
      i = skipQuoted(sql, i, "'", rules.backslashEscapes || escapeString);
      if (escapeString) {
        // El prefijo E ya se registró como palabra: se funde con la cadena.
        const e = tokens.pop()!;
        tokens.push({ kind: 'other', value: '', start: e.start, end: i });
      } else {
        tokens.push({ kind: 'other', value: '', start, end: i });
      }
      continue;
    }
    if (c === '"') {
      i = skipQuoted(sql, i, '"', !rules.doubleQuoteIsIdentifier && rules.backslashEscapes);
      tokens.push({ kind: 'other', value: '', start, end: i });
      continue;
    }
    if (c === '`' && rules.backtickIdentifiers) {
      i = skipQuoted(sql, i, '`', false);
      tokens.push({ kind: 'other', value: '', start, end: i });
      continue;
    }
    if (c === '[' && rules.bracketIdentifiers) {
      i = skipQuoted(sql, i, ']', false);
      tokens.push({ kind: 'other', value: '', start, end: i });
      continue;
    }
    if (c === '$' && rules.postgres) {
      // $tag$ … $tag$ (tag vacío o identificador). `$1` es un parámetro.
      const m = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/.exec(sql.slice(i, i + 64));
      const prevChar = sql[i - 1];
      if (m && !(prevChar !== undefined && isWordChar(prevChar))) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        i = close < 0 ? n : close + tag.length;
        tokens.push({ kind: 'other', value: '', start, end: i });
        continue;
      }
    }
    if (isWordStart(c)) {
      i++;
      while (i < n && isWordChar(sql[i]!)) i++;
      tokens.push({ kind: 'word', value: sql.slice(start, i).toLowerCase(), start, end: i });
      continue;
    }
    // Números, operadores, paréntesis, etc.
    i++;
    tokens.push({ kind: 'other', value: c, start, end: i });
  }
  return tokens;
}

function lineStarts(sql: string): number[] {
  const starts = [0];
  for (let i = 0; i < sql.length; i++) if (sql[i] === '\n') starts.push(i + 1);
  return starts;
}

/** Convierte un offset en línea/columna 1-based usando los inicios de línea precalculados. */
export function positionAt(starts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo]! + 1 };
}

/**
 * Separa un script en sentencias por `;`, respetando cadenas, identificadores
 * entre comillas, comentarios, *dollar quoting* y cuerpos `BEGIN ATOMIC … END`
 * de PostgreSQL. Las sentencias que solo tienen comentarios se omiten.
 */
export function splitStatements(sql: string, dialect: SqlDialect = 'postgres'): Statement[] {
  const tokens = tokenize(sql, dialect);
  const starts = lineStarts(sql);
  const result: Statement[] = [];

  let first: Token | null = null;
  let last: Token | null = null;
  // Profundidad de bloques `BEGIN ATOMIC … END` (y `CASE … END` dentro de ellos).
  let atomicDepth = 0;
  let prevWord = '';

  const flush = (endOffset: number, textEnd: number): void => {
    if (first) {
      const startPos = positionAt(starts, first.start);
      const endPos = positionAt(starts, endOffset);
      result.push({
        text: sql.slice(first.start, textEnd),
        start: first.start,
        end: endOffset,
        startLine: startPos.line,
        startColumn: startPos.column,
        endLine: endPos.line,
        endColumn: endPos.column,
      });
    }
    first = null;
    last = null;
    atomicDepth = 0;
    prevWord = '';
  };

  for (const token of tokens) {
    if (token.kind === 'semicolon' && atomicDepth === 0) {
      if (first && last) flush(token.end, (last as Token).end);
      else flush(token.end, token.start);
      continue;
    }
    if (!first) first = token;
    last = token;
    if (token.kind === 'word' && RULES[dialect].postgres) {
      if (token.value === 'atomic' && prevWord === 'begin') atomicDepth++;
      else if (atomicDepth > 0 && token.value === 'case') atomicDepth++;
      else if (atomicDepth > 0 && token.value === 'end') atomicDepth--;
      prevWord = token.value;
    }
  }
  if (first && last) flush((last as Token).end, (last as Token).end);
  return result;
}

/**
 * Sentencia que se ejecutaría con Ctrl+Enter para el cursor en `offset`
 * (specs/05): la que lo contiene; en una línea vacía entre dos, la anterior;
 * en una línea con solo comentarios, la siguiente.
 */
export function statementAt(sql: string, statements: Statement[], offset: number): Statement | undefined {
  if (statements.length === 0) return undefined;
  let prev: Statement | undefined;
  let next: Statement | undefined;
  for (const s of statements) {
    if (offset >= s.start && offset <= s.end) return s;
    if (s.end <= offset) prev = s;
    else if (!next && s.start > offset) next = s;
  }
  if (prev && !sql.slice(prev.end, offset).includes('\n')) return prev;
  const lineStart = sql.lastIndexOf('\n', offset - 1) + 1;
  const lineEndRaw = sql.indexOf('\n', offset);
  const line = sql.slice(lineStart, lineEndRaw < 0 ? sql.length : lineEndRaw);
  if (line.trim() === '') return prev ?? next;
  return next ?? prev;
}

/** Palabras iniciales de sentencias que no modifican datos ni estructura. */
const READ_KEYWORDS = new Set([
  'select',
  'with',
  'show',
  'explain',
  'values',
  'table',
  'set',
  'reset',
  'begin',
  'start',
  'commit',
  'rollback',
  'end',
  'abort',
  'savepoint',
  'release',
  'fetch',
  'move',
  'close',
  'discard',
  'describe',
  'desc',
  'use',
  'pragma',
]);

/** Palabras que, en cualquier parte de un `WITH` o `EXPLAIN ANALYZE`, indican escritura. */
const WRITE_KEYWORDS = new Set([
  'insert',
  'update',
  'delete',
  'merge',
  'truncate',
  'create',
  'alter',
  'drop',
  'grant',
  'revoke',
  'copy',
  'call',
  'do',
  'execute',
  'exec',
  'vacuum',
  'reindex',
  'cluster',
  'comment',
  'refresh',
  'replace',
  'rename',
  'lock',
]);

export interface StatementInfo {
  /** Primera palabra clave, en minúsculas (vacío si no hay). */
  keyword: string;
  /** Modifica datos o estructura (requiere confirmación en Producción y se bloquea en solo lectura). */
  isWrite: boolean;
  /** `UPDATE` o `DELETE` sin `WHERE`: siempre se confirma (specs/08). */
  unboundedWrite: boolean;
}

/** Clasificación ligera por palabras clave (sin parser completo). */
export function analyzeStatement(text: string, dialect: SqlDialect = 'postgres'): StatementInfo {
  const tokens = tokenize(text, dialect);
  const words = tokens.filter((t) => t.kind === 'word').map((t) => t.value);
  const keyword = words[0] ?? '';
  let isWrite: boolean;
  if (keyword === 'with' || keyword === 'explain') {
    const analyzing = keyword === 'with' || words.includes('analyze');
    isWrite = analyzing && words.some((w) => WRITE_KEYWORDS.has(w));
  } else if (keyword === 'select') {
    // `SELECT … INTO tabla` crea una tabla en PostgreSQL.
    isWrite = words.includes('into');
  } else {
    isWrite = keyword !== '' && !READ_KEYWORDS.has(keyword);
  }

  // Tras un WITH, la sentencia principal es la primera DML fuera de paréntesis (los CTE van entre paréntesis).
  let main = keyword;
  if (keyword === 'with') {
    main = '';
    let depth = 0;
    for (const t of tokens) {
      if (t.value === '(') depth++;
      else if (t.value === ')') depth--;
      else if (depth === 0 && ['select', 'insert', 'update', 'delete', 'merge'].includes(t.value)) {
        main = t.value;
        break;
      }
    }
  }
  const unboundedWrite = (main === 'update' || main === 'delete') && !words.includes('where');
  return { keyword, isWrite, unboundedWrite };
}
