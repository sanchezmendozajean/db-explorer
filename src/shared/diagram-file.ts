import { z } from 'zod';
import { EngineSchema } from './connection';
import type { DiagramRelation, DiagramTable, SchemaDiagram } from './metadata';

/**
 * Archivo de diagrama ER de DB Explorer (specs/13 §9): un JSON que la aplicación sabe dibujar sin volver a
 * consultar la base. Guarda una copia de las tablas y relaciones del momento, y las posiciones movidas a mano.
 * Nunca lleva contraseñas ni datos de las tablas: solo estructura.
 */

export const DIAGRAM_FILE_EXTENSION = 'dbxdiagram';
export const DIAGRAM_FILE_FORMAT = 'dbexplorer-diagram';
export const DIAGRAM_FILE_VERSION = 1;

const Name = z.string().max(500);
const Names = z.array(Name).max(200);

const DiagramTableSchema = z.object({
  name: Name,
  columns: z
    .array(
      z.object({
        name: Name,
        nativeType: z.string().max(200),
        nullable: z.boolean(),
        primaryKey: z.boolean(),
      }),
    )
    .max(5000),
});

const ForeignKeyTargetSchema = z.object({ schema: Name, table: Name, columns: Names });

const DiagramRelationSchema = z.object({
  name: Name,
  from: z.object({ schema: Name, table: Name, columns: Names }),
  to: ForeignKeyTargetSchema,
});

export const DiagramFileSchema = z.object({
  format: z.literal(DIAGRAM_FILE_FORMAT),
  version: z.number().int().min(1).max(DIAGRAM_FILE_VERSION),
  /** Fecha de la última vez que se guardó (ISO 8601). */
  savedAt: z.string().max(40),
  /** Conexión de origen: para volver a consultar. Se busca por `id` y, si no está, por nombre y motor. */
  connection: z.object({ id: z.string().max(100), name: z.string().max(200), engine: EngineSchema }),
  database: Name,
  schema: Name,
  tables: z.array(DiagramTableSchema).max(20_000),
  relations: z.array(DiagramRelationSchema).max(100_000),
  /** Posiciones movidas a mano: tabla → [x, y]. Las demás las coloca la disposición automática. */
  positions: z.record(Name, z.tuple([z.number().finite(), z.number().finite()])),
});

export type DiagramFile = z.infer<typeof DiagramFileSchema>;

export interface DiagramFileInput {
  connection: DiagramFile['connection'];
  database: string;
  schema: string;
  diagram: SchemaDiagram;
  positions: Record<string, [number, number]>;
  savedAt?: Date;
}

export function isDiagramFileName(name: string): boolean {
  return name.toLowerCase().endsWith(`.${DIAGRAM_FILE_EXTENSION}`);
}

/** Texto del archivo (JSON con sangría: se puede abrir y revisar en cualquier editor). */
export function serializeDiagramFile(input: DiagramFileInput): string {
  const tables: DiagramTable[] = input.diagram.tables;
  const relations: DiagramRelation[] = input.diagram.relations;
  const file: DiagramFile = {
    format: DIAGRAM_FILE_FORMAT,
    version: DIAGRAM_FILE_VERSION,
    savedAt: (input.savedAt ?? new Date()).toISOString(),
    connection: input.connection,
    database: input.database,
    schema: input.schema,
    tables,
    relations,
    positions: input.positions,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export type DiagramFileResult = { ok: true; file: DiagramFile } | { ok: false; reason: string };

/** Interpreta el texto de un archivo de diagrama; un archivo dañado o de una versión futura se rechaza con el motivo. */
export function parseDiagramFile(text: string): DiagramFileResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return { ok: false, reason: 'El archivo no es un JSON válido.' };
  }
  const header = z.object({ format: z.unknown(), version: z.unknown() }).safeParse(raw);
  if (!header.success || header.data.format !== DIAGRAM_FILE_FORMAT) {
    return { ok: false, reason: 'El archivo no es un diagrama de DB Explorer.' };
  }
  if (typeof header.data.version === 'number' && header.data.version > DIAGRAM_FILE_VERSION) {
    return { ok: false, reason: 'El diagrama se guardó con una versión más nueva de DB Explorer.' };
  }
  const parsed = DiagramFileSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'El archivo de diagrama está dañado o incompleto.' };
  return { ok: true, file: parsed.data };
}
