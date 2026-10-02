import type { ChoiceButton } from '../../stores/overlay-store';
import { useOverlayStore } from '../../stores/overlay-store';

/** Abre un diálogo de opciones y espera la respuesta (`null` si se cierra con Esc). */
export function askChoice(options: {
  title: string;
  message: string;
  items?: string[];
  buttons: ChoiceButton[];
}): Promise<string | null> {
  return new Promise((resolve) => {
    useOverlayStore.getState().openDialog({ id: 'choice', ...options, onResult: resolve });
  });
}

/** Confirmación de escritura (Producción / UPDATE-DELETE sin WHERE). */
export function askWriteConfirm(options: {
  connectionName: string;
  production: boolean;
  statements: string[];
  unbounded: boolean;
  language: string;
  allowSkip?: boolean;
}): Promise<{ confirmed: boolean; dontAskAgain: boolean }> {
  return new Promise((resolve) => {
    useOverlayStore.getState().openDialog({ id: 'writeConfirm', ...options, onResult: resolve });
  });
}

/** "Ver SQL" de la grilla: muestra las sentencias y resuelve `true` si se elige Aplicar. */
export function askSqlPreview(options: { statements: string[]; language: string }): Promise<boolean> {
  return new Promise((resolve) => {
    useOverlayStore.getState().openDialog({ id: 'sqlPreview', ...options, onResult: resolve });
  });
}
