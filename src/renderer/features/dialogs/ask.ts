import type { ConnectionConfig } from '@shared/connection';
import type { ModalIntent } from '../../components/Modal';
import type { ChoiceButton } from '../../stores/overlay-store';
import { useOverlayStore } from '../../stores/overlay-store';

/** Abre un diálogo de opciones y espera la respuesta (`null` si se cierra con Esc). */
export function askChoice(options: {
  title: string;
  message: string;
  items?: string[];
  buttons: ChoiceButton[];
  /** Ícono del encabezado (por defecto `question`). */
  icon?: string;
  /** Intención del encabezado (por defecto `info`). */
  intent?: ModalIntent;
}): Promise<string | null> {
  return new Promise((resolve) => {
    useOverlayStore.getState().openDialog({ id: 'choice', ...options, onResult: resolve });
  });
}

/** Confirmación de escritura (Producción / UPDATE-DELETE sin WHERE). */
export function askWriteConfirm(options: {
  connection: ConnectionConfig;
  production: boolean;
  statements: string[];
  unbounded: boolean;
  language: string;
  allowSkip?: boolean;
  rollbackNote?: boolean;
}): Promise<{ confirmed: boolean; dontAskAgain: boolean }> {
  return new Promise((resolve) => {
    useOverlayStore.getState().openDialog({ id: 'writeConfirm', ...options, onResult: resolve });
  });
}

/** "Ver SQL" de la grilla: muestra las sentencias y resuelve `true` si se elige Aplicar. */
export function askSqlPreview(options: {
  statements: string[];
  language: string;
  warning?: string;
}): Promise<boolean> {
  return new Promise((resolve) => {
    useOverlayStore.getState().openDialog({ id: 'sqlPreview', ...options, onResult: resolve });
  });
}
