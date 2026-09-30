import { z } from 'zod';

/**
 * Estado global de la interfaz, persistido en `userData/ui-state.json`
 * (tamaños de paneles, tema, vista activa de la barra lateral).
 * Cada campo tiene valor por defecto y `catch`, así un archivo parcialmente
 * dañado no hace perder el resto de la configuración.
 */

export const ThemePreferenceSchema = z.enum(['dark', 'light', 'system']);
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;

export const SideBarViewSchema = z.enum(['connections', 'files', 'history']);
export type SideBarView = z.infer<typeof SideBarViewSchema>;

/** Mapa id de panel → porcentaje (0..100), formato de `react-resizable-panels`. */
export const PanelLayoutSchema = z.record(z.string().max(50), z.number().min(0).max(100));
export type PanelLayout = z.infer<typeof PanelLayoutSchema>;

export const UiStateSchema = z.object({
  version: z.literal(1).catch(1),
  theme: ThemePreferenceSchema.catch('system'),
  sideBar: z
    .object({
      visible: z.boolean().catch(true),
      view: SideBarViewSchema.catch('connections'),
    })
    .catch({ visible: true, view: 'connections' }),
  panel: z
    .object({
      visible: z.boolean().catch(true),
      maximized: z.boolean().catch(false),
    })
    .catch({ visible: true, maximized: false }),
  layout: z
    .object({
      /** Barra lateral | área de edición. */
      main: PanelLayoutSchema.nullable().catch(null),
      /** Editor / panel de resultados. */
      editor: PanelLayoutSchema.nullable().catch(null),
    })
    .catch({ main: null, editor: null }),
});

export type UiState = z.infer<typeof UiStateSchema>;

export const DEFAULT_UI_STATE: UiState = {
  version: 1,
  theme: 'system',
  sideBar: { visible: true, view: 'connections' },
  panel: { visible: true, maximized: false },
  layout: { main: null, editor: null },
};

/** Interpreta datos arbitrarios como estado de UI, recuperando lo que se pueda. */
export function parseUiState(raw: unknown): UiState {
  const result = UiStateSchema.safeParse(raw ?? {});
  return result.success ? result.data : DEFAULT_UI_STATE;
}
