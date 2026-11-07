import { describe, expect, it } from 'vitest';
import type { SchemaDiagram } from '@shared/metadata';
import {
  DIAGRAM_FILE_FORMAT,
  isDiagramFileName,
  parseDiagramFile,
  serializeDiagramFile,
} from '@shared/diagram-file';

const diagram: SchemaDiagram = {
  tables: [
    { name: 'clientes', columns: [{ name: 'id', nativeType: 'INTEGER', nullable: false, primaryKey: true }] },
    {
      name: 'pedidos',
      columns: [
        { name: 'id', nativeType: 'INTEGER', nullable: false, primaryKey: true },
        { name: 'cliente_id', nativeType: 'INTEGER', nullable: true, primaryKey: false },
      ],
    },
  ],
  relations: [
    {
      name: '',
      from: { schema: 'main', table: 'pedidos', columns: ['cliente_id'] },
      to: { schema: 'main', table: 'clientes', columns: ['id'] },
    },
  ],
};

const input = {
  connection: { id: 'c1', name: 'Mi SQLite', engine: 'sqlite' as const },
  database: 'main',
  schema: 'main',
  diagram,
  positions: { pedidos: [120, 40] as [number, number] },
  savedAt: new Date('2026-11-06T12:00:00Z'),
};

describe('archivo de diagrama (.dbxdiagram)', () => {
  it('guarda y vuelve a leer el mismo diagrama', () => {
    const text = serializeDiagramFile(input);
    const parsed = parseDiagramFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.file.format).toBe(DIAGRAM_FILE_FORMAT);
    expect(parsed.file.savedAt).toBe('2026-11-06T12:00:00.000Z');
    expect(parsed.file.connection).toEqual(input.connection);
    expect({ tables: parsed.file.tables, relations: parsed.file.relations }).toEqual(diagram);
    expect(parsed.file.positions).toEqual({ pedidos: [120, 40] });
  });

  it('es un JSON con sangría que termina en salto de línea y no lleva contraseñas', () => {
    const text = serializeDiagramFile(input);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "tables": [');
    expect(text.toLowerCase()).not.toContain('password');
  });

  it('acepta un archivo con BOM', () => {
    expect(parseDiagramFile(String.fromCharCode(0xfeff) + serializeDiagramFile(input)).ok).toBe(true);
  });

  it('rechaza con motivo un JSON roto, ajeno, de versión futura o incompleto', () => {
    const reason = (text: string): string => {
      const r = parseDiagramFile(text);
      return r.ok ? '' : r.reason;
    };
    expect(reason('{ no es json')).toMatch(/JSON válido/);
    expect(reason('{"format":"otra-cosa","version":1}')).toMatch(/no es un diagrama/);
    expect(reason('[1,2]')).toMatch(/no es un diagrama/);
    const future = JSON.parse(serializeDiagramFile(input)) as Record<string, unknown>;
    future['version'] = 99;
    expect(reason(JSON.stringify(future))).toMatch(/versión más nueva/);
    const broken = JSON.parse(serializeDiagramFile(input)) as Record<string, unknown>;
    delete broken['tables'];
    expect(reason(JSON.stringify(broken))).toMatch(/dañado/);
    const badPosition = JSON.parse(serializeDiagramFile(input)) as Record<string, unknown>;
    badPosition['positions'] = { pedidos: ['x', 1] };
    expect(reason(JSON.stringify(badPosition))).toMatch(/dañado/);
  });

  it('reconoce la extensión sin distinguir mayúsculas', () => {
    expect(isDiagramFileName('Diagrama-main.dbxdiagram')).toBe(true);
    expect(isDiagramFileName('X.DBXDIAGRAM')).toBe(true);
    expect(isDiagramFileName('x.json')).toBe(false);
    expect(isDiagramFileName('dbxdiagram')).toBe(false);
  });
});
