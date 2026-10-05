/**
 * Separación de sentencias SQL por dialecto (specs/03 §Separación de sentencias).
 * Módulo puro compartido: lo usa el renderer para la sentencia activa y la
 * ejecución, sin ir al proceso de BD.
 *
 * Cubre PostgreSQL, MariaDB (`DELIMITER`), SQLite y SQL Server (`GO`).
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

export interface SplitOptions {
  /**
   * Una línea en blanco también separa sentencias (además del `;`). Las
   * líneas en blanco dentro de cadenas, comentarios o bloques no cuentan.
   */
  blankLineSeparator?: boolean;
}

/** ¿Hay una línea en blanco en el espacio entre dos tokens? Una línea con solo un comentario no está en blanco. */
function hasBlankLine(gap: string, dialect: SqlDialect): boolean {
  let code = gap.replace(/\/\*[\s\S]*?\*\//g, 'c').replace(/--[^\n]*/g, 'c');
  if (RULES[dialect].hashComments) code = code.replace(/#[^\n]*/g, 'c');
  return /\n[ \t\r\f\v]*\n/.test(code);
}

/** Rango [inicio, fin) de la línea que contiene `offset`, sin el salto de línea. */
function lineAround(sql: string, offset: number): { start: number; end: number } {
  const start = sql.lastIndexOf('\n', offset - 1) + 1;
  const eol = sql.indexOf('\n', offset);
  return { start, end: eol < 0 ? sql.length : eol };
}

/**
 * `GO` de SQL Server: sola en su línea, opcionalmente con un número
 * (`GO 5`, que se acepta pero no repite el lote) y un comentario `--`.
 */
function isGoLine(sql: string, token: Token): boolean {
  if (token.kind !== 'word' || token.value !== 'go') return false;
  const line = lineAround(sql, token.start);
  if (sql.slice(line.start, token.start).trim() !== '') return false;
  const rest = sql.slice(token.end, line.end).replace(/--.*$/, '');
  return /^\s*(\d+)?\s*$/.test(rest);
}

/** Palabras tras `BEGIN` que indican una transacción y no un bloque (SQL Server). */
const SQLSERVER_TRANSACTION = new Set(['tran', 'transaction', 'distributed', 'dialog', 'conversation']);

/** Objetos de SQL Server cuyo cuerpo ocupa todo el lote: dentro no separan `;` ni líneas en blanco. */
const SQLSERVER_BATCH_OBJECTS = new Set(['procedure', 'proc', 'function', 'trigger', 'view']);

/**
 * Separa un script en sentencias por `;` (y, si se pide, por líneas en
 * blanco), respetando cadenas, identificadores entre comillas, comentarios,
 * *dollar quoting* y cuerpos `BEGIN ATOMIC … END` de PostgreSQL. Además:
 * - SQL Server: `GO` termina el lote; `BEGIN … END`, `BEGIN TRY/CATCH` y los
 *   cuerpos de `CREATE PROCEDURE/FUNCTION/TRIGGER/VIEW` no se cortan.
 * - MariaDB: `DELIMITER xx` cambia el separador; bloques `BEGIN … END` (con
 *   `IF`, `CASE`, `LOOP`, `WHILE`, `REPEAT`) no se cortan.
 * - SQLite: cuerpos `BEGIN … END` de `CREATE TRIGGER`.
 * Las sentencias que solo tienen comentarios se omiten.
 */
export function splitStatements(
  sql: string,
  dialect: SqlDialect = 'postgres',
  options: SplitOptions = {},
): Statement[] {
  const tokens = tokenize(sql, dialect);
  const starts = lineStarts(sql);
  const result: Statement[] = [];

  let first: Token | null = null;
  let last: Token | null = null;
  // Profundidad de bloques (`BEGIN … END`, `CASE … END`…): dentro no se separa.
  let blockDepth = 0;
  // Cuerpo de procedimiento o función de SQL Server: llega hasta `GO`.
  let wholeBatch = false;
  let prevWord = '';
  let wordIndex = 0;
  let firstWord = '';
  // Separador de MariaDB (`DELIMITER`); `;` por defecto.
  let delimiter = ';';
  // Tokens a saltar (resto de la línea de `GO` o `DELIMITER`, o un separador de varios caracteres).
  let skipUntil = -1;

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
    blockDepth = 0;
    wholeBatch = false;
    prevWord = '';
    wordIndex = 0;
    firstWord = '';
  };
  const lastEnd = (): number => (last as Token | null)?.end ?? 0;

  tokens.forEach((token, i) => {
    if (token.start < skipUntil) return;

    if (dialect === 'sqlserver' && isGoLine(sql, token)) {
      if (first) flush(lastEnd(), lastEnd());
      skipUntil = lineAround(sql, token.start).end;
      return;
    }
    if (dialect === 'mariadb' && !first && token.kind === 'word' && token.value === 'delimiter') {
      const line = lineAround(sql, token.start);
      if (sql.slice(line.start, token.start).trim() === '') {
        const value = sql.slice(token.end, line.end).trim().split(/\s+/)[0] ?? '';
        if (value) delimiter = value;
        skipUntil = line.end;
        return;
      }
    }
    if (delimiter !== ';' && !`'"\``.includes(sql[token.start]!)) {
      // El separador puede ir pegado a una palabra (`END$$`: `$` es válido en identificadores).
      const found = sql.slice(token.start, token.end + delimiter.length - 1).indexOf(delimiter);
      const at = token.start + found;
      if (found >= 0 && at < token.end) {
        if (at > token.start) {
          first ??= token;
          last = { ...token, end: at };
        }
        const end = at + delimiter.length;
        if (first) flush(end, lastEnd());
        skipUntil = end;
        return;
      }
    }
    const separates = blockDepth === 0 && !wholeBatch;
    if (token.kind === 'semicolon' && delimiter === ';' && separates) {
      if (first) flush(token.end, lastEnd());
      return;
    }
    // Línea en blanco entre dos tokens de la misma sentencia: termina la sentencia anterior.
    if (
      options.blankLineSeparator &&
      separates &&
      first &&
      hasBlankLine(sql.slice(lastEnd(), token.start), dialect)
    ) {
      flush(lastEnd(), lastEnd());
    }
    if (!first) first = token;
    last = token;
    if (token.kind !== 'word') return;

    const next = tokens[i + 1]?.value ?? '';
    const word = token.value;
    if (wordIndex === 0) firstWord = word;
    if (dialect === 'postgres') {
      if (word === 'atomic' && prevWord === 'begin') blockDepth++;
      else if (blockDepth > 0 && word === 'case') blockDepth++;
      else if (blockDepth > 0 && word === 'end') blockDepth--;
    } else if (dialect === 'sqlserver' || dialect === 'mariadb' || dialect === 'sqlite') {
      if (
        dialect === 'sqlserver' &&
        wordIndex > 0 &&
        wordIndex <= 3 &&
        (firstWord === 'create' || firstWord === 'alter') &&
        SQLSERVER_BATCH_OBJECTS.has(word)
      ) {
        wholeBatch = true;
      }
      if (word === 'begin') {
        const isBlock =
          dialect === 'sqlserver'
            ? !SQLSERVER_TRANSACTION.has(next)
            : wordIndex > 0 || (dialect === 'mariadb' && next === 'not');
        if (isBlock) blockDepth++;
      } else if (blockDepth > 0 && word === 'end') {
        blockDepth--;
      } else if (blockDepth > 0 && prevWord !== 'end') {
        // `END IF`, `END CASE`, `END LOOP`…: la palabra tras END no abre otro bloque.
        if (word === 'case') blockDepth++;
        else if (
          dialect === 'mariadb' &&
          ['if', 'loop', 'while', 'repeat'].includes(word) &&
          !['(', 'not', 'exists'].includes(next)
        ) {
          blockDepth++;
        }
      }
    }
    prevWord = word;
    wordIndex++;
  });
  if (first) flush(lastEnd(), lastEnd());
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
  'declare',
  'print',
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

/** Sentencias de estructura (o que confirman la transacción en algunos motores, como `TRUNCATE`). */
const STRUCTURE_KEYWORDS = new Set([
  'create',
  'alter',
  'drop',
  'truncate',
  'rename',
  'grant',
  'revoke',
  'comment',
]);

export interface StatementInfo {
  /** Primera palabra clave, en minúsculas (vacío si no hay). */
  keyword: string;
  /** Modifica datos o estructura (requiere confirmación en Producción y se bloquea en solo lectura). */
  isWrite: boolean;
  /** `UPDATE` o `DELETE` sin `WHERE`: siempre se confirma (specs/08). */
  unboundedWrite: boolean;
  /** Cambia la estructura (`CREATE`, `ALTER`, `DROP`…): no se puede explicar y ejecutar (specs/12 §4). */
  isStructure: boolean;
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
    // `SELECT … INTO tabla` crea una tabla (PostgreSQL, SQL Server).
    isWrite = words.includes('into');
  } else if (keyword === 'begin' || keyword === 'if' || keyword === 'while') {
    // Bloques (`BEGIN … END`, `IF … `): escriben si contienen alguna escritura; `BEGIN` solo es lectura.
    isWrite = words.slice(1).some((w) => WRITE_KEYWORDS.has(w));
  } else if (keyword === 'pragma') {
    // `PRAGMA x = valor` cambia la base (SQLite); `PRAGMA table_info(t)` solo lee.
    isWrite = tokens.some((t) => t.value === '=');
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
  return { keyword, isWrite, unboundedWrite, isStructure: STRUCTURE_KEYWORDS.has(keyword) };
}
