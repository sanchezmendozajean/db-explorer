import type { Monaco } from './setup';

let loading: Promise<Monaco> | null = null;
let loaded: Monaco | null = null;

/** Carga Monaco una sola vez (chunk diferido). */
export function loadMonaco(): Promise<Monaco> {
  loading ??= import('./setup').then((m) => {
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
