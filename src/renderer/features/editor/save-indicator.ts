import { create } from 'zustand';

/** Duración mínima del ícono girando en la status bar durante un guardado (specs/11 §4). */
const MIN_SPIN_MS = 300;

interface SaveIndicatorStore {
  active: number;
  /** Marca el inicio de un guardado; devuelve la función para marcar el fin. */
  start: () => () => void;
}

export const useSaveIndicator = create<SaveIndicatorStore>((set) => ({
  active: 0,
  start: () => {
    const started = performance.now();
    set((s) => ({ active: s.active + 1 }));
    return () => {
      const wait = Math.max(0, MIN_SPIN_MS - (performance.now() - started));
      setTimeout(() => set((s) => ({ active: Math.max(0, s.active - 1) })), wait);
    };
  },
}));
