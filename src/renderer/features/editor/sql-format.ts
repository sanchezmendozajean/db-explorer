import { format } from 'sql-formatter';
import type { SqlLanguage } from 'sql-formatter';
import type { Engine } from '@shared/connection';
import { splitStatements } from '@shared/splitter';
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
  return format(sql, { language: engine ? LANGUAGE[engine] : 'sql', tabWidth });
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

/** Formatea un fragmento (la selección) como un todo. Lanza si no se puede analizar. */
export function formatFragment(text: string, engine: Engine | undefined, tabWidth: number): string {
  const leading = /^\s*/.exec(text)![0];
  const trailing = /\s*$/.exec(text)![0];
  return `${leading}${formatOne(text.trim(), engine, tabWidth)}${trailing}`;
}
