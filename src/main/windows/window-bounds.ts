import { z } from 'zod';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Ventana guardada: dimensiones normales (no las de maximizada) y si estaba maximizada. */
export const WindowStateSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  maximized: z.boolean().default(false),
});

export type WindowState = z.infer<typeof WindowStateSchema>;

export const DEFAULT_WINDOW_SIZE = { width: 1400, height: 900 } as const;
export const MIN_WINDOW_SIZE = { width: 1024, height: 640 } as const;

/** Lado mínimo de la ventana que debe quedar sobre un monitor para considerarla alcanzable. */
const MIN_VISIBLE = 100;

export function parseWindowState(raw: unknown): WindowState | null {
  const parsed = WindowStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

/**
 * Ubicación con la que abrir la ventana. Si lo guardado ya no cae sobre ningún monitor conectado
 * (p. ej. se desconectó el segundo monitor) se usa el tamaño por defecto, centrado (sin `x`/`y`);
 * si no cabe en el área visible, se reduce sin bajar del mínimo.
 */
export function resolveWindowBounds(
  saved: WindowState | null,
  workAreas: readonly Rect[],
): { bounds: { width: number; height: number; x?: number; y?: number }; maximized: boolean } {
  const primary = workAreas[0];
  const fit = (size: { width: number; height: number }, area: Rect | undefined) => ({
    width: Math.max(MIN_WINDOW_SIZE.width, Math.min(size.width, area?.width ?? size.width)),
    height: Math.max(MIN_WINDOW_SIZE.height, Math.min(size.height, area?.height ?? size.height)),
  });
  if (!saved) return { bounds: fit(DEFAULT_WINDOW_SIZE, primary), maximized: false };

  const area = workAreas.find((a) => {
    const o = overlap(saved, a);
    return o.width >= MIN_VISIBLE && o.height >= MIN_VISIBLE;
  });
  if (!area) return { bounds: fit(DEFAULT_WINDOW_SIZE, primary), maximized: saved.maximized };

  const size = fit(saved, area);
  const x = Math.max(area.x, Math.min(saved.x, area.x + area.width - size.width));
  const y = Math.max(area.y, Math.min(saved.y, area.y + area.height - size.height));
  return { bounds: { ...size, x, y }, maximized: saved.maximized };
}
