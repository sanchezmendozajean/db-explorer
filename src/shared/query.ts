/**
 * Tipos de ejecución de consultas compartidos entre db-host, main y renderer
 * (specs/03 §Interfaz y specs/06).
 */

/** Tipo lógico de columna, para formatear y alinear en la grilla (specs/03). */
export type LogicalType =
  | 'integer'
  | 'decimal'
  | 'float'
  | 'boolean'
  | 'text'
  | 'date'
  | 'time'
  | 'datetime'
  | 'datetimetz'
  | 'json'
  | 'binary'
  | 'uuid'
  | 'other';

/**
 * Valor crudo de una celda. Decimales, enteros grandes, fechas, JSON y
 * binarios llegan como texto tal como los entrega el motor (sin pérdida de
 * precisión ni cambio de zona); el formateo es solo de presentación.
 */
export type CellValue = string | number | boolean | null;

export interface ResultColumn {
  name: string;
  /** Tipo nativo completo, p. ej. `numeric(12,2)`. */
  nativeType: string;
  logicalType: LogicalType;
  /** Tabla de origen, si el motor la informa. */
  sourceSchema?: string;
  sourceTable?: string;
  sourceColumn?: string;
  isPk?: boolean;
}

export interface ExecuteRequest {
  queryId: string;
  /** Sesión dedicada (una por pestaña de editor). */
  sessionId: string;
  connectionId: string;
  /** Base de la sesión; sin valor, la predeterminada de la conexión. */
  database?: string;
  schema?: string;
  /** Sentencias ya separadas por el renderer, en orden. */
  statements: string[];
  /** Límite de filas por resultado; `null` = sin límite. */
  maxRows: number | null;
}

export interface FetchMoreRequest {
  queryId: string;
  statementIndex: number;
  /** Filas a traer; `null` = todas las restantes. */
  count: number | null;
}

export type MessageSeverity = 'info' | 'notice' | 'warning' | 'error';

/** Eventos de ejecución que viajan db-host → main → renderer, en lotes. */
export type QueryEvent =
  | { type: 'statement-start'; queryId: string; index: number; startedAt: number }
  | { type: 'columns'; queryId: string; index: number; columns: ResultColumn[] }
  | { type: 'rows'; queryId: string; index: number; rows: CellValue[][] }
  | {
      type: 'statement-done';
      queryId: string;
      index: number;
      /** Etiqueta del motor: `SELECT`, `INSERT`, `CREATE TABLE`… */
      command: string;
      /** Filas leídas hasta ahora (resultados) o afectadas (DML). */
      rowCount: number;
      affected?: number;
      /** Quedan filas sin leer. */
      truncated: boolean;
      /** El cursor sigue abierto y se puede pedir "Cargar más". */
      hasMore: boolean;
      durationMs: number;
    }
  | {
      type: 'statement-error';
      queryId: string;
      index: number;
      message: string;
      detail?: string;
      hint?: string;
      /** Posición 1-based dentro del texto de la sentencia, si el motor la informa. */
      position?: number;
      code?: string;
      cancelled: boolean;
      durationMs: number;
    }
  | { type: 'message'; queryId: string; index: number; severity: MessageSeverity; text: string }
  /**
   * Último evento de una ejecución. El renderer termina la ejecución con este
   * evento y no con la respuesta de `query:execute`, que viaja por otro canal
   * IPC y puede llegar antes que los últimos lotes de filas.
   */
  | { type: 'execution-done'; queryId: string; summary: ExecuteSummary }
  /** Último evento de un "Cargar más" (mismo motivo). */
  | { type: 'fetch-done'; queryId: string; index: number; result: FetchMoreResult | null; error?: string };

export interface ExecuteSummary {
  queryId: string;
  /** Sentencias que llegaron a ejecutarse (incluida la que falló). */
  executed: number;
  failed: boolean;
  cancelled: boolean;
  durationMs: number;
}

export interface FetchMoreResult {
  loaded: number;
  hasMore: boolean;
}

/** Filas por lote en los eventos `rows` (nunca se serializa un resultado grande entero). */
export const ROW_BATCH_SIZE = 500;
