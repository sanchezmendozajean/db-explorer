import { format } from 'sql-formatter';
import type { SqlLanguage } from 'sql-formatter';
import type { Engine } from '@shared/connection';
import { splitStatements, statementAt } from '@shared/splitter';
import type { SplitOptions, SqlDialect } from '@shared/splitter';

/** Dialecto de `sql-formatter` por motor (specs/05: formateo con el dialecto de la conexión). */
const LANGUAGE: Record<Engine, SqlLanguage> = {
  postgres: 'postgresql',
  mariadb: 'mariadb',
  sqlite: 'sqlite',
  sqlserver: 'transactsql',
};

export interface FormatOptions {
  tabWidth: number;
  split?: SplitOptions;
}

export interface FormatResult {
  text: string;
  /** Sentencias que no se pudieron analizar (quedan como estaban). */
  failed: number;
}

function formatOne(sql: string, engine: Engine | undefined, tabWidth: number): string {
  return inlineFromClause(format(sql, { language: engine ? LANGUAGE[engine] : 'sql', tabWidth }), tabWidth);
}

const FROM_LINE = /^( *)((?:delete\s+)?from)$/i;

const indentOf = (line: string): number => /^ */.exec(line)![0].length;

/**
 * Ajusta la cláusula FROM que deja `sql-formatter`: la primera tabla queda en
 * la línea del `from` y el resto del bloque (los `join`) se alinea con el
 * `from`, sin sangría. Los elementos de una lista separada por comas
 * conservan su sangría.
 */
export function inlineFromClause(sql: string, tabWidth: number): string {
  const lines = sql.split('\n');
  // De abajo hacia arriba: un FROM interno (subconsulta) se ajusta antes que el que lo contiene.
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = FROM_LINE.exec(lines[i]!);
    if (!m) continue;
    const base = m[1]!.length;
    let end = i + 1;
    while (end < lines.length && lines[end]!.trim() !== '' && indentOf(lines[end]!) > base) end++;
    if (end === i + 1) continue;
    const item = base + tabWidth;
    let prevItem = lines[i + 1]!;
    let keep = false;
    for (let j = i + 2; j < end; j++) {
      const line = lines[j]!;
      if (indentOf(line) === item) {
        // Un AND/OR de la condición de un JOIN queda sangrado bajo él.
        keep = prevItem.trimEnd().endsWith(',') || /^\s*(and|or)\b/i.test(line);
        prevItem = line;
      }
      if (!keep && indentOf(line) >= item) lines[j] = line.slice(tabWidth);
    }
    lines.splice(i, 2, `${lines[i]} ${lines[i + 1]!.trim()}`);
  }
  return lines.join('\n');
}

/**
 * Formatea un script sentencia por sentencia: lo que hay entre sentencias
 * (separadores, `GO`, `DELIMITER`, comentarios sueltos, líneas en blanco)
 * queda tal cual, así el formateador no rompe esas construcciones. Una
 * sentencia que no se puede analizar se deja como estaba.
 */
export function formatScript(text: string, engine: Engine | undefined, options: FormatOptions): FormatResult {
  const dialect: SqlDialect = engine ?? 'generic';
  const statements = splitStatements(text, dialect, options.split);
  let out = '';
  let cursor = 0;
  let failed = 0;
  for (const s of statements) {
    out += text.slice(cursor, s.start);
    try {
      out += formatOne(s.text, engine, options.tabWidth);
    } catch {
      failed++;
      out += s.text;
    }
    cursor = s.start + s.text.length;
  }
  out += text.slice(cursor);
  return { text: out, failed };
}

/**
 * Rango (desplazamientos en `text`) de la sentencia que ejecutaría Ctrl+Enter
 * con el cursor en `offset`, o `undefined` si no hay ninguna.
 */
export function statementRangeAt(
  text: string,
  offset: number,
  engine: Engine | undefined,
  split?: SplitOptions,
): { start: number; end: number } | undefined {
  const s = statementAt(text, splitStatements(text, engine ?? 'generic', split), offset);
  return s ? { start: s.start, end: s.start + s.text.length } : undefined;
}

/** Formatea un fragmento (la selección) como un todo. Lanza si no se puede analizar. */
export function formatFragment(text: string, engine: Engine | undefined, tabWidth: number): string {
  const leading = /^\s*/.exec(text)![0];
  const trailing = /\s*$/.exec(text)![0];
  return `${leading}${formatOne(text.trim(), engine, tabWidth)}${trailing}`;
}
