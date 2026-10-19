import { create } from 'zustand';
import type { UpdateStatus } from '@shared/updates';

interface UpdateStore {
  status: UpdateStatus;
  setStatus: (status: UpdateStatus) => void;
}

export const useUpdateStore = create<UpdateStore>((set) => ({
  status: { state: 'idle' },
  setStatus: (status) => set({ status }),
}));

/** Ya hay una versión encontrada (descargándose o lista): oculta "Buscar actualización". */
export function updateFound(status: UpdateStatus): boolean {
  return status.state === 'downloading' || status.state === 'ready';
}
