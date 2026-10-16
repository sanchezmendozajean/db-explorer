import type * as MonacoApi from 'monaco-editor/editor/editor.api';

/**
 * Modelos de Monaco que no son documentos del espacio (p. ej. la definición de una rutina) y la
 * pestaña a la que pertenecen: así el autocompletado, el hover y el formateo saben su conexión.
 */
const owners = new WeakMap<MonacoApi.editor.ITextModel, string>();

export function setModelOwner(model: MonacoApi.editor.ITextModel, tabId: string): void {
  owners.set(model, tabId);
}

export function modelOwner(model: MonacoApi.editor.ITextModel): string | undefined {
  return owners.get(model);
}
