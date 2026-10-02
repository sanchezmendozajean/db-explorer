import type { Engine } from './connection';
import type { CellValue, LogicalType, ParamStatement } from './query';
import { qualifiedName, quoteIdent } from './sql-quote';
import { sqlLiteral } from './sql-literals';

/**
 * Sentencias de la edición en grilla (specs/06 §Edición de datos):
 * `UPDATE … WHERE clave = …`, `INSERT` y `DELETE` parametrizados, más su
 * versión con literales para "Ver SQL" (solo lectura).
 */

export interface EditTable {
  engine: Engine;
  /** Esquema (en MariaDB, la base; en SQLite no se usa). */
  schema?: string;
  name: string;
  /** Columnas de la tabla presentes en el resultado: nombre real y tipo lógico. */
  columns: { name: string; type: LogicalType }[];
  /** Índices (en `columns`) de las columnas de la clave. */
  keyColumns: number[];
}

export type EditOperation =
  /** `key`: valores originales de las columnas clave, en el orden de `keyColumns`. */
  | { kind: 'update'; key: CellValue[]; changes: { column: number; value: CellValue }[] }
  /** Columnas sin valor quedan con su valor por defecto. */
  | { kind: 'insert'; values: { column: number; value: CellValue }[] }
  | { kind: 'delete'; key: CellValue[] };

export interface GeneratedStatement {
  statement: ParamStatement;
  /** La misma sentencia con los valores como literales ("Ver SQL"). */
  literal: string;
}

function placeholder(engine: Engine, n: number): string {
  if (engine === 'postgres') return `$${n}`;
  if (engine === 'sqlserver') return `@p${n}`;
  return '?';
}

/** Genera una sentencia por operación, en el orden recibido. */
export function buildStatements(table: EditTable, operations: EditOperation[]): GeneratedStatement[] {
  const { engine } = table;
  const target = qualifiedName(engine, { schema: table.schema, name: table.name });
  const ident = (column: number): string => quoteIdent(engine, table.columns[column]!.name);
  return operations.map((op) => {
    const params: CellValue[] = [];
    const types: LogicalType[] = [];
    const literals: string[] = [];
    const bind = (column: number, value: CellValue): string => {
      const type = table.columns[column]!.type;
      params.push(value);
      types.push(type);
      literals.push(sqlLiteral(engine, value, type));
      return placeholder(engine, params.length);
    };
    const where = (key: CellValue[]): string =>
      table.keyColumns.map((column, i) => `${ident(column)} = ${bind(column, key[i] ?? null)}`).join(' AND ');

    let sql: string;
    if (op.kind === 'update') {
      const set = op.changes.map((c) => `${ident(c.column)} = ${bind(c.column, c.value)}`).join(', ');
      sql = `UPDATE ${target} SET ${set} WHERE ${where(op.key)}`;
    } else if (op.kind === 'delete') {
      sql = `DELETE FROM ${target} WHERE ${where(op.key)}`;
    } else if (op.values.length === 0) {
      sql =
        engine === 'mariadb' ? `INSERT INTO ${target} () VALUES ()` : `INSERT INTO ${target} DEFAULT VALUES`;
    } else {
      const cols = op.values.map((v) => ident(v.column)).join(', ');
      const values = op.values.map((v) => bind(v.column, v.value)).join(', ');
      sql = `INSERT INTO ${target} (${cols}) VALUES (${values})`;
    }
    return {
      statement: { sql, params, types, expectOne: op.kind !== 'insert' },
      literal: `${withLiterals(engine, sql, literals)};`,
    };
  });
}

/** Reemplaza los marcadores de parámetro por sus literales (en orden; `$10` antes que `$1`). */
function withLiterals(engine: Engine, sql: string, literals: string[]): string {
  if (engine === 'postgres') return sql.replace(/\$(\d+)/g, (_, n: string) => literals[Number(n) - 1] ?? '');
  if (engine === 'sqlserver') return sql.replace(/@p(\d+)/g, (_, n: string) => literals[Number(n) - 1] ?? '');
  let i = 0;
  return sql.replace(/\?/g, () => literals[i++] ?? '');
}
