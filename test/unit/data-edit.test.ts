import { describe, expect, it } from 'vitest';
import { buildStatements } from '@shared/data-edit';
import type { EditTable } from '@shared/data-edit';
import { csvEncoder, encodeAll, inList, insertEncoder, jsonEncoder, markdownEncoder } from '@shared/export';
import type { ResultColumn } from '@shared/query';
import { sqlLiteral } from '@shared/sql-literals';

const table = (engine: EditTable['engine']): EditTable => ({
  engine,
  schema: engine === 'sqlite' ? undefined : 'ventas',
  name: 'Clientes',
  columns: [
    { name: 'id', type: 'integer' },
    { name: 'nombre', type: 'text' },
    { name: 'foto', type: 'binary' },
  ],
  keyColumns: [0],
});

describe('literales SQL', () => {
  it('por dialecto', () => {
    expect(sqlLiteral('postgres', "O'Neil", 'text')).toBe("'O''Neil'");
    expect(sqlLiteral('sqlserver', 'ñ', 'text')).toBe("N'ñ'");
    expect(sqlLiteral('mariadb', 'a\\b', 'text')).toBe("'a\\\\b'");
    expect(sqlLiteral('postgres', true, 'boolean')).toBe('TRUE');
    expect(sqlLiteral('sqlserver', false, 'boolean')).toBe('0');
    expect(sqlLiteral('mariadb', '12.50', 'decimal')).toBe('12.50');
    expect(sqlLiteral('mariadb', '12,50', 'decimal')).toBe("'12,50'");
    expect(sqlLiteral('sqlite', null, 'text')).toBe('NULL');
    expect(sqlLiteral('sqlserver', '0x89AB', 'binary')).toBe('0x89AB');
    expect(sqlLiteral('mariadb', '0x89ab', 'binary')).toBe("X'89AB'");
    expect(sqlLiteral('postgres', '\\x89ab', 'binary')).toBe("'\\x89ab'::bytea");
  });
});

describe('sentencias de la edición en grilla', () => {
  it('UPDATE, INSERT y DELETE parametrizados con su versión literal', () => {
    const [update, insert, remove, empty] = buildStatements(table('postgres'), [
      { kind: 'update', key: [7], changes: [{ column: 1, value: "O'Neil" }] },
      {
        kind: 'insert',
        values: [
          { column: 1, value: 'Ana' },
          { column: 2, value: null },
        ],
      },
      { kind: 'delete', key: [9] },
      { kind: 'insert', values: [] },
    ]);
    expect(update!.statement).toEqual({
      sql: 'UPDATE ventas."Clientes" SET nombre = $1 WHERE id = $2',
      params: ["O'Neil", 7],
      types: ['text', 'integer'],
      expectOne: true,
    });
    expect(update!.literal).toBe(`UPDATE ventas."Clientes" SET nombre = 'O''Neil' WHERE id = 7;`);
    expect(insert!.statement.sql).toBe('INSERT INTO ventas."Clientes" (nombre, foto) VALUES ($1, $2)');
    expect(insert!.statement.expectOne).toBe(false);
    expect(remove!.literal).toBe('DELETE FROM ventas."Clientes" WHERE id = 9;');
    expect(empty!.statement.sql).toBe('INSERT INTO ventas."Clientes" DEFAULT VALUES');
  });

  it('marcadores de cada motor', () => {
    const op = [{ kind: 'update' as const, key: [1], changes: [{ column: 1, value: 'x' }] }];
    expect(buildStatements(table('sqlserver'), op)[0]!.statement.sql).toBe(
      'UPDATE ventas.Clientes SET nombre = @p1 WHERE id = @p2',
    );
    expect(buildStatements(table('mariadb'), op)[0]!.statement.sql).toBe(
      'UPDATE ventas.Clientes SET nombre = ? WHERE id = ?',
    );
    expect(buildStatements(table('sqlite'), op)[0]!.literal).toBe(
      "UPDATE Clientes SET nombre = 'x' WHERE id = 1;",
    );
    expect(buildStatements(table('mariadb'), [{ kind: 'insert', values: [] }])[0]!.statement.sql).toBe(
      'INSERT INTO ventas.Clientes () VALUES ()',
    );
  });
});

describe('codificadores de copiar como y exportar', () => {
  const columns: ResultColumn[] = [
    { name: 'id', nativeType: 'int', logicalType: 'integer' },
    { name: 'nombre', nativeType: 'text', logicalType: 'text' },
  ];
  const rows = [
    [1, 'Ana; "la" primera'],
    [2, null],
  ];

  it('CSV con comillas y separador', () => {
    expect(encodeAll(csvEncoder(columns, { separator: ';', header: true }), rows)).toBe(
      'id;nombre\r\n1;"Ana; ""la"" primera"\r\n2;\r\n',
    );
  });

  it('JSON en lotes', () => {
    const enc = jsonEncoder(columns, { pretty: false });
    const text = enc.begin() + enc.rows([rows[0]!], true) + enc.rows([rows[1]!], false) + enc.end();
    expect(JSON.parse(text)).toEqual([
      { id: 1, nombre: 'Ana; "la" primera' },
      { id: 2, nombre: null },
    ]);
  });

  it('Markdown, INSERT y lista IN', () => {
    expect(encodeAll(markdownEncoder(columns, { nullAs: 'NULL' }), [[1, 'a|b']])).toBe(
      '| id | nombre |\n| --- | --- |\n| 1 | a\\|b |\n',
    );
    expect(encodeAll(insertEncoder(columns, { engine: 'sqlserver', table: '[dbo].[t]' }), rows)).toBe(
      `INSERT INTO [dbo].[t] (id, nombre) VALUES (1, N'Ana; "la" primera');\nINSERT INTO [dbo].[t] (id, nombre) VALUES (2, NULL);\n`,
    );
    expect(inList('postgres', columns[1]!, ['a', 'b', 'a', null])).toBe("('a', 'b')");
  });
});
