import { z } from 'zod';

/**
 * Estado de un espacio de trabajo (specs/11 §3), guardado en
 * `userData/workspaces/<sha1 de la ruta>.json` (nunca dentro de la carpeta).
 * Las rutas son relativas al espacio (absolutas si el archivo está fuera).
 */

const Name = z.string().max(1000);

export const ScriptTabStateSchema = z.object({
  type: z.literal('script'),
  file: z.string().min(1).max(4096),
  connectionId: z.string().max(64).optional(),
  database: Name.optional(),
  schema: Name.optional(),
  /** `ICodeEditorViewState` de Monaco (cursor, scroll, plegados); opaco para main. */
  viewState: z.unknown().optional(),
});
export type ScriptTabState = z.infer<typeof ScriptTabStateSchema>;

export const WorkspaceStateSchema = z.object({
  path: z.string().max(4096),
  /** Las entradas inválidas se descartan al leer (ver `parseWorkspaceState`). */
  tabs: z.array(ScriptTabStateSchema).max(500),
  activeTab: z.number().int().min(-1),
  fileConnections: z
    .record(
      z.string().max(4096),
      z.object({ connectionId: z.string().max(64), database: Name.optional(), schema: Name.optional() }),
    )
    .optional(),
});
export type WorkspaceState = z.infer<typeof WorkspaceStateSchema>;

/** Lee el estado recuperando las pestañas válidas aunque otras estén dañadas. */
export function parseWorkspaceState(raw: unknown): WorkspaceState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const tabs = Array.isArray(r['tabs'])
    ? r['tabs'].flatMap((t) => {
        const parsed = ScriptTabStateSchema.safeParse(t);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  const activeTab = typeof r['activeTab'] === 'number' && Number.isInteger(r['activeTab']) ? r['activeTab'] : 0;
  const fileConnections = WorkspaceStateSchema.shape.fileConnections.safeParse(r['fileConnections']);
  return {
    path: typeof r['path'] === 'string' ? r['path'] : '',
    tabs,
    activeTab: Math.min(Math.max(activeTab, -1), tabs.length - 1),
    fileConnections: fileConnections.success ? fileConnections.data : undefined,
  };
}

export interface WorkspaceInfo {
  /** Ruta absoluta de la carpeta del espacio. */
  path: string;
  /** Nombre visible (última parte de la ruta). */
  name: string;
  state: WorkspaceState | null;
}

export interface ScriptFile {
  content: string;
  mtimeMs: number;
  /** El archivo empezaba con BOM UTF-8 (se conserva al guardar). */
  bom: boolean;
  eol: 'LF' | 'CRLF';
}
