/**
 * Estado de la actualización automática (main → renderer). `unsupported` aplica a la versión portable,
 * al modo de desarrollo y a las pruebas: ahí no hay nada que buscar.
 */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'none' }
  | { state: 'error'; message: string }
  | { state: 'unsupported' };
