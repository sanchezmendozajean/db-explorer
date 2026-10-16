import { tokenize } from '@shared/splitter';
import type { Token } from '@shared/splitter';
import { unquote } from '@shared/sql-context';

/** Restricción CHECK leída del `CREATE TABLE` de SQLite (el motor no la expone en un PRAGMA). */
export interface SqliteCheck {
  /** Nombre dado con `CONSTRAINT nombre CHECK (…)`; sin valor si es anónima. */
  name?: string;
  /** Columna en cuya definición está (`CHECK` de columna); vacío si es de tabla. */
  columns: string[];
  /** Expresión entre paréntesis, tal como se escribió. */
  expression: string;
}

const TABLE_CLAUSES = new Set(['constraint', 'primary', 'unique', 'foreign', 'check']);

function isIdent(sql: string, t: Token | undefined): boolean {
  if (!t) return false;
  if (t.kind === 'word') return true;
  const c = sql[t.start];
  return t.kind === 'other' && (c === '"' || c === '`' || c === '[');
}

/**
 * Restricciones CHECK de un `CREATE TABLE` de SQLite: las de columna (`edad int CHECK (edad >= 0)`) y
 * las de tabla (`CONSTRAINT positivo CHECK (a > 0)`). El texto del DDL viene de `sqlite_schema`.
 */
export function parseSqliteChecks(createSql: string): SqliteCheck[] {
  const tokens = tokenize(createSql, 'sqlite');
  const open = tokens.findIndex((t) => t.kind === 'other' && t.value === '(');
  if (open < 0) return [];

  const checks: SqliteCheck[] = [];
  let depth = 0;
  // Principio de la definición actual (columna o restricción de tabla) a profundidad 1.
  let segmentStart = open + 1;
  for (let i = open; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind !== 'other' && t.kind !== 'word') continue;
    if (t.kind === 'other' && t.value === '(') {
      depth++;
      continue;
    }
    if (t.kind === 'other' && t.value === ')') {
      depth--;
      if (depth === 0) break;
      continue;
    }
    if (depth === 1 && t.kind === 'other' && t.value === ',') {
      segmentStart = i + 1;
      continue;
    }
    if (depth !== 1 || t.kind !== 'word' || t.value !== 'check' || tokens[i + 1]?.value !== '(') continue;

    // Expresión: hasta el paréntesis que cierra.
    let level = 0;
    let end = i + 1;
    for (; end < tokens.length; end++) {
      const e = tokens[end]!;
      if (e.kind !== 'other') continue;
      if (e.value === '(') level++;
      else if (e.value === ')' && --level === 0) break;
    }
    const expression = createSql.slice(tokens[i + 1]!.end, tokens[end]?.start ?? createSql.length).trim();

    // `CONSTRAINT nombre` justo antes.
    const name =
      tokens[i - 2]?.value === 'constraint' && isIdent(createSql, tokens[i - 1])
        ? unquote(createSql.slice(tokens[i - 1]!.start, tokens[i - 1]!.end))
        : undefined;

    // Definición de columna si el segmento no empieza con una palabra de restricción de tabla.
    const first = tokens[segmentStart];
    const isTableLevel = first?.kind === 'word' && TABLE_CLAUSES.has(first.value) && first.value !== 'check';
    const isColumn =
      !isTableLevel && !(first?.kind === 'word' && first.value === 'check') && isIdent(createSql, first);
    checks.push({
      name,
      columns: isColumn ? [unquote(createSql.slice(first!.start, first!.end))] : [],
      expression,
    });
    i = end;
  }
  return checks;
}
