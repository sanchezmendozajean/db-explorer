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
  const activeTab =
    typeof r['activeTab'] === 'number' && Number.isInteger(r['activeTab']) ? r['activeTab'] : 0;
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
  /** Archivos del estado que ya no existen (se omiten de las pestañas). */
  missing: string[];
  /** La carpeta configurada no existe (unidad desconectada, borrada): no se abrió (specs/11 §2). */
  unavailable?: boolean;
}

export interface ScriptFile {
  content: string;
  mtimeMs: number;
  /** El archivo empezaba con BOM UTF-8 (se conserva al guardar). */
  bom: boolean;
  eol: 'LF' | 'CRLF';
}

/** Entrada del árbol de la vista Archivos. */
export interface FileNode {
  name: string;
  /** Ruta absoluta. */
  path: string;
  dir: boolean;
  children?: FileNode[];
}

/** Nombres reservados de Windows (con o sin extensión). */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Valida un nombre de archivo o carpeta (una sola parte de ruta). Devuelve el
 * motivo si no es válido, en español, o `null` si lo es (reglas de Windows).
 */
export function invalidFileName(name: string): string | null {
  if (name.trim() === '') return 'Escribe un nombre.';
  if (name === '.' || name === '..') return 'El nombre no puede ser "." ni "..".';
  if (/[\/:*?"<>|]/.test(name)) return 'El nombre no puede contener \ / : * ? " < > |';
  // Caracteres de control (U+0000 a U+001F): inválidos en Windows.
  for (const ch of name) if (ch.charCodeAt(0) < 32) return 'El nombre contiene caracteres no válidos.';
  if (/[. ]$/.test(name)) return 'El nombre no puede terminar en punto ni en espacio.';
  if (RESERVED_NAMES.test(name)) return `"${name}" es un nombre reservado de Windows.`;
  if (name.length > 255) return 'El nombre es demasiado largo.';
  return null;
}

/** Nombre para un archivo nuevo: se agrega `.sql` si no se escribió extensión (specs/07). */
export function withDefaultExtension(name: string): string {
  return /\.[^.\/]+$/.test(name.trim()) ? name.trim() : `${name.trim()}.sql`;
}

/** Nombre libre para una copia: "x copia.sql", "x copia 2.sql"… (specs/07). */
export function copyName(name: string, exists: (candidate: string) => boolean): string {
  if (!exists(name)) return name;
  const dot = name.lastIndexOf('.');
  const hasExt = dot > 0;
  const base = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : '';
  for (let n = 1; ; n++) {
    const candidate = `${base} copia${n > 1 ? ` ${n}` : ''}${ext}`;
    if (!exists(candidate)) return candidate;
  }
}

/** Extensiones que se abren en el editor (specs/07); las demás, con la aplicación del sistema. */
export const TEXT_EXTENSIONS = ['sql', 'txt', 'json', 'md', 'csv', 'log', 'xml', 'yml', 'yaml'] as const;

export function isTextFile(name: string): boolean {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return name.includes('.') && (TEXT_EXTENSIONS as readonly string[]).includes(ext);
}
