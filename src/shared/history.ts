import { z } from 'zod';

/** Entrada del historial de consultas (specs/06): una sentencia ejecutada. */
export interface HistoryEntry {
  id: number;
  /** Fecha de inicio (epoch ms). */
  at: number;
  connectionId: string;
  /** Nombre de la conexión al ejecutar (se conserva aunque después se renombre o borre). */
  connectionName: string;
  engine: string;
  database?: string;
  sql: string;
  durationMs: number;
  /** Filas devueltas o afectadas. */
  rows?: number;
  ok: boolean;
  error?: string;
}

export const HistoryQuerySchema = z.object({
  /** Texto a buscar dentro del SQL. */
  text: z.string().max(1000).optional(),
  connectionId: z.string().max(64).optional(),
  limit: z.number().int().positive().max(5000).optional(),
});
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;
