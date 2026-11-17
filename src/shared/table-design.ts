import type { Engine } from './connection';
import type { ColumnInfo } from './metadata';
import { qualifiedName, quoteIdent } from './sql-quote';

/**
 * Diseño editable de una tabla (pestaña Estructura): el borrador de columnas del usuario y la
 * generación del `CREATE TABLE` o de los `ALTER TABLE` que lo llevan desde la estructura leída.
 */

export interface DesignColumn {
  /** Identificador estable de la fila en la interfaz. */
  key: string;
  /** Columna leída de la base; ausente en las columnas nuevas. */
  original?: ColumnInfo;
  name: string;
  /** Tipo nativo completo, tal como se escribe en SQL (`nvarchar(50)`, `decimal(10,2)`). */
  type: string;
  nullable: boolean;
  /** Expresión SQL tal cual (`0`, `'activo'`, `CURRENT_TIMESTAMP`); vacío = sin valor por defecto. */
  defaultValue: string;
  primaryKey: boolean;
  autoIncrement: boolean;
  comment: string;
  /** Columna existente marcada para eliminar. */
  deleted?: boolean;
}

export interface TableDesign {
  name: string;
  columns: DesignColumn[];
}

/** Tipos sugeridos por motor (el campo admite cualquier otro texto). */
export const COMMON_TYPES: Record<Engine, string[]> = {
  postgres: [
    'integer',
    'bigint',
    'smallint',
    'numeric(18,2)',
    'real',
    'double precision',
    'boolean',
    'varchar(255)',
    'char(1)',
    'text',
    'date',
    'time',
    'timestamp',
    'timestamptz',
    'uuid',
    'json',
    'jsonb',
    'bytea',
  ],
  mariadb: [
    'int',
    'bigint',
    'smallint',
    'tinyint',
    'decimal(18,2)',
    'float',
    'double',
    'boolean',
    'varchar(255)',
    'char(1)',
    'text',
    'longtext',
    'date',
    'time',
    'datetime',
    'timestamp',
    'json',
    'blob',
  ],
  sqlserver: [
    'int',
    'bigint',
    'smallint',
    'tinyint',
    'decimal(18,2)',
    'float',
    'real',
    'bit',
    'varchar(255)',
    'nvarchar(255)',
    'nvarchar(max)',
    'char(1)',
    'date',
    'time',
    'datetime2',
    'datetime',
    'uniqueidentifier',
    'varbinary(max)',
    'xml',
  ],
  sqlite: ['INTEGER', 'TEXT', 'REAL', 'NUMERIC', 'BLOB'],
};

export function columnFromInfo(key: string, info: ColumnInfo): DesignColumn {
  return {
    key,
    original: info,
    name: info.name,
    type: info.nativeType,
    nullable: info.nullable,
    defaultValue: info.defaultValue ?? '',
    primaryKey: info.primaryKey,
    autoIncrement: !!info.autoIncrement,
    comment: info.comment ?? '',
  };
}

export function newDesignColumn(
  engine: Engine,
  key: string,
  overrides: Partial<DesignColumn> = {},
): DesignColumn {
  return {
    key,
    name: '',
    type: COMMON_TYPES[engine][0]!,
    nullable: true,
    defaultValue: '',
    primaryKey: false,
    autoIncrement: false,
    comment: '',
    ...overrides,
  };
}

/** Qué campos de una columna se pueden editar según el motor y si la tabla o la columna son nuevas. */
export interface EditableFields {
  name: boolean;
  type: boolean;
  nullable: boolean;
  defaultValue: boolean;
  primaryKey: boolean;
  autoIncrement: boolean;
  comment: boolean;
}

/** Motivo (para el tooltip) por el que un motor no permite cambiar algo de una columna existente. */
export const LOCKED_REASON = {
  sqlite: 'SQLite no permite modificar columnas existentes sin reconstruir la tabla.',
  existingKey: 'La clave primaria de una tabla existente no se edita aquí.',
  existingAuto: 'El autoincremento de una columna existente no se puede cambiar aquí.',
  comment: 'Este motor no admite comentarios de columna desde esta pantalla.',
} as const;

export function editableFields(engine: Engine, newTable: boolean, column: DesignColumn): EditableFields {
  const fresh = newTable || !column.original;
  const alterable = fresh || engine !== 'sqlite';
  const commentable = engine === 'postgres' || engine === 'mariadb';
  return {
    name: true,
    type: alterable,
    nullable: alterable && !column.primaryKey,
    defaultValue: alterable && !column.autoIncrement,
    // La clave y el contador solo se definen al crear la tabla.
    primaryKey: newTable,
    autoIncrement: newTable,
    comment: commentable && alterable,
  };
}

/** Códigos de los errores de validación; la interfaz los traduce. */
export type DesignIssue =
  | { code: 'nameRequired' }
  | { code: 'noColumns' }
  | { code: 'columnNameRequired'; column: number }
  | { code: 'columnDuplicate'; column: number; name: string }
  | { code: 'typeRequired'; column: number }
  | { code: 'autoIncrementType'; column: number }
  | { code: 'autoIncrementKey'; column: number }
  | { code: 'autoIncrementMany' };

const INTEGER_TYPE = /int/i;

/** Valida el borrador. La lista vacía significa que se pueden generar las sentencias. */
export function validateDesign(engine: Engine, design: TableDesign, newTable: boolean): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const live = design.columns.filter((c) => !c.deleted);
  if (newTable && !design.name.trim()) issues.push({ code: 'nameRequired' });
  if (live.length === 0) issues.push({ code: 'noColumns' });
  const seen = new Set<string>();
  const keys = live.filter((c) => c.primaryKey).length;
  if (live.filter((c) => c.autoIncrement).length > 1) issues.push({ code: 'autoIncrementMany' });
  design.columns.forEach((c, i) => {
    if (c.deleted) return;
    const name = c.name.trim();
    if (!name) issues.push({ code: 'columnNameRequired', column: i });
    else if (seen.has(name.toLowerCase())) issues.push({ code: 'columnDuplicate', column: i, name });
    else seen.add(name.toLowerCase());
    if (!c.type.trim()) issues.push({ code: 'typeRequired', column: i });
    if (newTable && c.autoIncrement) {
      if (!INTEGER_TYPE.test(c.type)) issues.push({ code: 'autoIncrementType', column: i });
      if (!c.primaryKey || keys !== 1) issues.push({ code: 'autoIncrementKey', column: i });
    }
  });
  void engine;
  return issues;
}

// ——— Generación de SQL ———

const sqlString = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** Valor por defecto tal como lo informa la base, listo para repetirlo en un `MODIFY` de MariaDB/MySQL. */
function mariadbDefault(raw: string): string {
  const v = raw.trim();
  if (v === '' || /^null$/i.test(v)) return 'NULL';
  if (/^'.*'$/s.test(v) || /^-?\d+(\.\d+)?$/.test(v) || /^current_timestamp/i.test(v) || v.includes('('))
    return v;
  // MySQL 8 devuelve las cadenas sin comillas.
  return sqlString(v);
}

interface Parts {
  engine: Engine;
  schema: string;
  table: string;
}

const tableName = (p: Parts): string => qualifiedName(p.engine, { schema: p.schema, name: p.table });
const q = (p: Parts, name: string): string => quoteIdent(p.engine, name);

/** Definición de una columna al crear la tabla o agregarla (`inlineKey`: SQLite lleva su clave en la columna). */
function definition(p: Parts, c: DesignColumn, inlineKey: boolean): string {
  const nullable = c.nullable && !c.primaryKey;
  const out = [q(p, c.name.trim()), c.type.trim()];
  if (c.autoIncrement && p.engine === 'postgres') out.push('GENERATED BY DEFAULT AS IDENTITY');
  if (c.autoIncrement && p.engine === 'sqlserver') out.push('IDENTITY(1,1)');
  if (!nullable && !(inlineKey && p.engine === 'sqlite')) out.push('NOT NULL');
  else if (nullable && p.engine === 'sqlserver') out.push('NULL');
  if (inlineKey) out.push('PRIMARY KEY');
  if (c.autoIncrement && p.engine === 'mariadb') out.push('AUTO_INCREMENT');
  if (c.autoIncrement && p.engine === 'sqlite') out.push('AUTOINCREMENT');
  const def = c.defaultValue.trim();
  if (def && !c.autoIncrement) out.push(`DEFAULT ${def}`);
  if (c.comment.trim() && p.engine === 'mariadb') out.push(`COMMENT ${sqlString(c.comment.trim())}`);
  return out.join(' ');
}

function commentStatement(p: Parts, column: string, comment: string): string {
  const text = comment.trim();
  return `COMMENT ON COLUMN ${tableName(p)}.${q(p, column)} IS ${text ? sqlString(text) : 'NULL'}`;
}

/** `CREATE TABLE` (y los comentarios de PostgreSQL) de un diseño nuevo. */
export function buildCreateStatements(engine: Engine, schema: string, design: TableDesign): string[] {
  const p: Parts = { engine, schema, table: design.name.trim() };
  const columns = design.columns
    .filter((c) => !c.deleted)
    .map((c) => (c.primaryKey ? { ...c, nullable: false } : c));
  const sqliteInline = engine === 'sqlite' && columns.some((c) => c.autoIncrement);
  const lines = columns.map((c) => '  ' + definition(p, c, sqliteInline && c.autoIncrement));
  const keys = columns.filter((c) => c.primaryKey && !(sqliteInline && c.autoIncrement));
  if (keys.length > 0) lines.push(`  PRIMARY KEY (${keys.map((c) => q(p, c.name.trim())).join(', ')})`);
  const statements = [`CREATE TABLE ${tableName(p)} (\n${lines.join(',\n')}\n)`];
  if (engine === 'postgres') {
    for (const c of columns)
      if (c.comment.trim()) statements.push(commentStatement(p, c.name.trim(), c.comment));
  }
  return statements;
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Borra la restricción DEFAULT de una columna de SQL Server (su nombre lo genera el motor). */
function dropSqlServerDefault(p: Parts, column: string): string {
  const full = tableName(p);
  const literal = `N'${full.replace(/'/g, "''")}'`;
  return (
    `DECLARE @dc sysname = (SELECT d.name FROM sys.default_constraints d JOIN sys.columns c ` +
    `ON c.object_id = d.parent_object_id AND c.column_id = d.parent_column_id ` +
    `WHERE d.parent_object_id = OBJECT_ID(${literal}) AND c.name = N'${column.replace(/'/g, "''")}'); ` +
    `IF @dc IS NOT NULL EXEC(N'ALTER TABLE ' + N'${full.replace(/'/g, "''")}' + N' DROP CONSTRAINT ' + QUOTENAME(@dc))`
  );
}

/**
 * Sentencias que llevan la tabla existente a lo que describe el diseño. Orden: eliminar, renombrar,
 * modificar y agregar. Solo se emite lo que cambió. Lista vacía = sin cambios.
 */
export function buildAlterStatements(
  engine: Engine,
  schema: string,
  table: string,
  design: TableDesign,
): string[] {
  const p: Parts = { engine, schema, table };
  const t = tableName(p);
  const out: string[] = [];

  for (const c of design.columns) {
    if (!c.deleted || !c.original) continue;
    if (engine === 'sqlserver' && c.original.defaultValue) out.push(dropSqlServerDefault(p, c.original.name));
    out.push(`ALTER TABLE ${t} DROP COLUMN ${q(p, c.original.name)}`);
  }

  const kept = design.columns.filter((c) => !c.deleted && c.original);
  for (const c of kept) {
    const o = c.original!;
    const name = c.name.trim();
    const renamed = name !== o.name;
    const typeChanged = !same(c.type, o.nativeType);
    const nullChanged = c.nullable !== o.nullable;
    const defaultChanged = c.defaultValue.trim() !== (o.defaultValue ?? '').trim();
    const commentChanged = c.comment.trim() !== (o.comment ?? '').trim();

    if (renamed) {
      if (engine === 'sqlserver') {
        const from = `${tableName(p)}.${q(p, o.name)}`.replace(/'/g, "''");
        out.push(`EXEC sp_rename N'${from}', N'${name.replace(/'/g, "''")}', N'COLUMN'`);
      } else {
        out.push(`ALTER TABLE ${t} RENAME COLUMN ${q(p, o.name)} TO ${q(p, name)}`);
      }
    }
    if (engine === 'sqlite') continue;
    const col = q(p, name);
    if (engine === 'postgres') {
      if (typeChanged) out.push(`ALTER TABLE ${t} ALTER COLUMN ${col} TYPE ${c.type.trim()}`);
      if (nullChanged)
        out.push(`ALTER TABLE ${t} ALTER COLUMN ${col} ${c.nullable ? 'DROP' : 'SET'} NOT NULL`);
      if (defaultChanged) {
        const d = c.defaultValue.trim();
        out.push(`ALTER TABLE ${t} ALTER COLUMN ${col} ${d ? `SET DEFAULT ${d}` : 'DROP DEFAULT'}`);
      }
      if (commentChanged) out.push(commentStatement(p, name, c.comment));
    } else if (engine === 'mariadb') {
      if (typeChanged || nullChanged || defaultChanged || commentChanged) {
        const parts = [col, c.type.trim(), c.nullable ? 'NULL' : 'NOT NULL'];
        const d = c.defaultValue.trim();
        // `MODIFY` redefine la columna entera: el valor por defecto no tocado se repite.
        if (d) parts.push(`DEFAULT ${defaultChanged ? d : mariadbDefault(d)}`);
        if (o.autoIncrement) parts.push('AUTO_INCREMENT');
        if (c.comment.trim()) parts.push(`COMMENT ${sqlString(c.comment.trim())}`);
        out.push(`ALTER TABLE ${t} MODIFY COLUMN ${parts.join(' ')}`);
      }
    } else {
      if (typeChanged || nullChanged) {
        out.push(`ALTER TABLE ${t} ALTER COLUMN ${col} ${c.type.trim()} ${c.nullable ? 'NULL' : 'NOT NULL'}`);
      }
      if (defaultChanged) {
        out.push(dropSqlServerDefault(p, name));
        const d = c.defaultValue.trim();
        if (d) out.push(`ALTER TABLE ${t} ADD DEFAULT ${d} FOR ${col}`);
      }
    }
  }

  for (const c of design.columns) {
    if (c.deleted || c.original) continue;
    out.push(
      `ALTER TABLE ${t} ADD ${engine === 'postgres' || engine === 'mariadb' ? 'COLUMN ' : ''}${definition(p, c, false)}`,
    );
    if (engine === 'postgres' && c.comment.trim()) out.push(commentStatement(p, c.name.trim(), c.comment));
  }
  return out;
}
