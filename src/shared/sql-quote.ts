import type { Engine } from './connection';

/** Palabras reservadas frecuentes que obligan a entrecomillar un identificador. */
const RESERVED = new Set(
  (
    'all analyse analyze and any array as asc asymmetric authorization between both case cast check collate column ' +
    'constraint create cross current_date current_role current_time current_timestamp current_user default ' +
    'deferrable desc distinct do else end except false fetch for foreign from full grant group having ilike in ' +
    'initially inner intersect into is isnull join key lateral leading left like limit localtime localtimestamp ' +
    'natural not notnull null offset on only or order outer overlaps placing primary references returning right ' +
    'select session_user similar some symmetric table tablesample then to trailing true union unique user using ' +
    'values variadic verbose when where window with'
  ).split(' '),
);

/**
 * Entrecomilla un identificador solo si hace falta, con el carácter del
 * dialecto: `"x"` (PostgreSQL, SQLite), `` `x` `` (MariaDB), `[x]` (SQL Server).
 * En PostgreSQL las mayúsculas obligan a entrecomillar.
 */
export function quoteIdent(engine: Engine, name: string): string {
  const simple = engine === 'postgres' ? /^[a-z_][a-z0-9_$]*$/ : /^[A-Za-z_][A-Za-z0-9_$]*$/;
  if (simple.test(name) && !RESERVED.has(name.toLowerCase())) return name;
  switch (engine) {
    case 'mariadb':
      return `\`${name.replace(/`/g, '``')}\``;
    case 'sqlserver':
      return `[${name.replace(/]/g, ']]')}]`;
    default:
      return `"${name.replace(/"/g, '""')}"`;
  }
}

/** Nombre calificado `esquema.objeto` (o `base.objeto` en MariaDB, o solo el objeto en SQLite). */
export function qualifiedName(engine: Engine, parts: { schema?: string; name: string }): string {
  if (engine === 'sqlite' || !parts.schema) return quoteIdent(engine, parts.name);
  return `${quoteIdent(engine, parts.schema)}.${quoteIdent(engine, parts.name)}`;
}
