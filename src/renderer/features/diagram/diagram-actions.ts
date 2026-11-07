/**
 * Puente entre los comandos de teclado (Ctrl + `+`, Ctrl + `-`, Ctrl + 0 con el diagrama enfocado) y las
 * vistas de diagrama montadas. Cada vista registra sus acciones en cada dibujo (así siempre ven el modelo
 * actual) y el comando usa las del diagrama que tiene el foco.
 */
export interface DiagramActions {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}

const registered = new Map<string, DiagramActions>();
let focused: string | null = null;

export function registerDiagram(tabId: string, actions: DiagramActions): void {
  registered.set(tabId, actions);
}

export function unregisterDiagram(tabId: string): void {
  registered.delete(tabId);
  if (focused === tabId) focused = null;
}

/** El diagrama de esta pestaña tomó el foco. */
export function focusDiagram(tabId: string): void {
  focused = tabId;
}

export function activeDiagram(): DiagramActions | null {
  return focused ? (registered.get(focused) ?? null) : null;
}
