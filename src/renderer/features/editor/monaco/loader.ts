import type { Monaco } from './setup';

let loading: Promise<Monaco> | null = null;
let loaded: Monaco | null = null;

/** Variantes de Cascadia Code que usa el editor (normal, cursiva de comentarios y negrita). */
const EDITOR_FONTS = ['13px "Cascadia Code"', 'italic 13px "Cascadia Code"', '600 13px "Cascadia Code"'];

/**
 * Monaco mide el ancho de los caracteres al crear el editor. Si la fuente
 * empaquetada todavía no cargó, mide con la de respaldo y el cursor queda
 * desplazado respecto del texto: se espera a la fuente y, si alguna carga
 * después (otro tamaño, zoom), se vuelve a medir.
 */
async function waitForFonts(monaco: Monaco): Promise<void> {
  try {
    await Promise.all(EDITOR_FONTS.map((f) => document.fonts.load(f)));
  } catch {
    // Si la fuente no carga se usa la de respaldo; la remedición de abajo lo corrige si llega tarde.
  }
  document.fonts.addEventListener('loadingdone', () => monaco.editor.remeasureFonts());
  monaco.editor.remeasureFonts();
}

/** Carga Monaco una sola vez (chunk diferido) con la fuente del editor lista. */
export function loadMonaco(): Promise<Monaco> {
  loading ??= import('./setup').then(async (m) => {
    await waitForFonts(m.monaco);
    loaded = m.monaco;
    return m.monaco;
  });
  return loading;
}

/** Monaco ya cargado, o `null` si todavía no. */
export function monacoIfLoaded(): Monaco | null {
  return loaded;
}

export type { Monaco };
