import { create } from 'zustand';

/**
 * Solo para el hito M1: permite alternar los datos de ejemplo para revisar los
 * estados vacíos (specs/04 §16). Se elimina cuando lleguen datos reales (M2/M3).
 */
interface SampleStore {
  enabled: boolean;
  toggle: () => void;
}

export const useSampleStore = create<SampleStore>((set) => ({
  enabled: true,
  toggle: () => set((s) => ({ enabled: !s.enabled })),
}));
