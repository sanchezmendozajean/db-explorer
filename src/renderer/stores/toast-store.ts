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
  /** No se oculta sola (avisos que piden una decisión). */
  sticky?: boolean;
  /** Duración propia en ms, en lugar de `TOAST_TIMEOUT_MS`. */
  durationMs?: number;
  /** Muestra un indicador animado en lugar del ícono y no se oculta sola hasta que se reemplace. */
  loading?: boolean;
}

interface ToastStore {
  toasts: Toast[];
  show: (toast: Omit<Toast, 'id'>) => number;
  dismiss: (id: number) => void;
  /** Cambia el texto de una notificación visible (p. ej. avance de una exportación). */
  update: (id: number, message: string) => void;
  /** Reemplaza el contenido de una notificación visible (p. ej. "Buscando…" → resultado) y reinicia su ocultado. */
  replace: (id: number, patch: Partial<Omit<Toast, 'id'>>) => void;
}

/** Duración antes de ocultarse sola (specs/04 §14). Los errores no se ocultan solos. */
export const TOAST_TIMEOUT_MS = 8000;

let nextId = 1;

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  show: (toast) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    if (toast.severity !== 'error' && !toast.sticky && !toast.loading)
      setTimeout(() => get().dismiss(id), toast.durationMs ?? TOAST_TIMEOUT_MS);
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  update: (id, message) =>
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, message } : t)) })),
  replace: (id, patch) => {
    const current = get().toasts.find((t) => t.id === id);
    if (!current) return;
    const next = { ...current, loading: false, ...patch };
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? next : t)) }));
    if (next.severity !== 'error' && !next.sticky && !next.loading)
      setTimeout(() => get().dismiss(id), next.durationMs ?? TOAST_TIMEOUT_MS);
  },
}));

export function showToast(
  severity: ToastSeverity,
  message: string,
  actions?: ToastAction[],
  options: { sticky?: boolean; durationMs?: number; loading?: boolean } = {},
): number {
  return useToastStore.getState().show({
    severity,
    message,
    actions,
    sticky: options.sticky,
    durationMs: options.durationMs,
    loading: options.loading,
  });
}

export function isToastVisible(id: number | undefined): boolean {
  return id !== undefined && useToastStore.getState().toasts.some((t) => t.id === id);
}
