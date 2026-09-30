import { create } from 'zustand';

export type ToastSeverity = 'info' | 'warning' | 'error' | 'success';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  severity: ToastSeverity;
  message: string;
  actions?: ToastAction[];
}

interface ToastStore {
  toasts: Toast[];
  show: (toast: Omit<Toast, 'id'>) => number;
  dismiss: (id: number) => void;
}

/** Duración antes de ocultarse sola (specs/04 §14). Los errores no se ocultan solos. */
export const TOAST_TIMEOUT_MS = 8000;

let nextId = 1;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  show: (toast) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    if (toast.severity !== 'error') setTimeout(() => get().dismiss(id), TOAST_TIMEOUT_MS);
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function showToast(severity: ToastSeverity, message: string, actions?: ToastAction[]): number {
  return useToastStore.getState().show({ severity, message, actions });
}
