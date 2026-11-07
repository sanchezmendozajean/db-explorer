import { create } from 'zustand';
import { withoutKey } from '@shared/records';
import type { DiagramFile } from '@shared/diagram-file';
import { parseDiagramFile } from '@shared/diagram-file';
import type { SchemaDiagram } from '@shared/metadata';
import { es } from '../../i18n/es';
import { useConnectionsStore } from '../../stores/connections-store';
import { useUiStore } from '../../stores/ui-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import { ensureConnected } from '../connections/actions';
import { MAX_TABLES, initialSelection } from './diagram-layout';

/**
 * Estado de cada pestaña de diagrama ER. Vive fuera del componente (como el de las pestañas de objeto)
 * para que los gestos de ratón y los atajos lo cambien sin depender del ciclo de dibujo de React.
 */

export type DiagramLoad =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; diagram: SchemaDiagram };

/** Posiciones movidas a mano: tabla → [x, y]. */
export type ManualPositions = Record<string, [number, number]>;

export interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

export interface DiagramTabState {
  load: DiagramLoad;
  /** Tablas elegidas cuando el esquema supera el límite (`null`: aún no se eligieron). */
  chosen: Set<string> | null;
  /** Selección en curso en el selector de tablas. */
  draft: Set<string> | null;
  filter: string;
  manual: ManualPositions;
  view: ViewTransform;
  selected: string | null;
  /** Ya se hizo la primera vista (ajustar a la ventana o centrar la tabla pedida). */
  placed: boolean;
  /** Última tabla pedida que ya se atendió. */
  focus: string | undefined;
  exporting: boolean;
  /** Se está guardando el archivo del diagrama. */
  saving: boolean;
  origin: DiagramOrigin | null;
}

/** Conexión de la que salió el diagrama (la del archivo, si la conexión ya no existe). */
export type DiagramOrigin = DiagramFile['connection'];

export interface DiagramScopeRef {
  connectionId: string;
  database: string;
  schema: string;
  /** Clave de las posiciones guardadas (ver `diagramKey`). */
  key: string;
}

const LOADING_STATE = (key: string, focus: string | undefined): DiagramTabState => ({
  load: { status: 'loading' },
  chosen: null,
  draft: null,
  filter: '',
  manual: useUiStore.getState().diagramPositions[key] ?? {},
  view: { x: 0, y: 0, k: 1 },
  selected: null,
  placed: false,
  focus,
  exporting: false,
  saving: false,
  origin: null,
});

export const EMPTY_DIAGRAM_STATE: DiagramTabState = {
  load: { status: 'loading' },
  chosen: null,
  draft: null,
  filter: '',
  manual: {},
  view: { x: 0, y: 0, k: 1 },
  selected: null,
  placed: false,
  focus: undefined,
  exporting: false,
  saving: false,
  origin: null,
};

export const useDiagramStore = create<{ byTab: Record<string, DiagramTabState> }>(() => ({ byTab: {} }));

export function diagramState(tabId: string): DiagramTabState {
  return useDiagramStore.getState().byTab[tabId] ?? EMPTY_DIAGRAM_STATE;
}

/** Cambia campos del estado de una pestaña (no hace nada si la pestaña ya se cerró). */
export function patchDiagram(tabId: string, patch: Partial<DiagramTabState>): void {
  useDiagramStore.setState((s) => {
    const current = s.byTab[tabId];
    return current ? { byTab: { ...s.byTab, [tabId]: { ...current, ...patch } } } : s;
  });
}

export function setDiagramView(tabId: string, update: (v: ViewTransform) => ViewTransform): void {
  const current = useDiagramStore.getState().byTab[tabId];
  if (current) patchDiagram(tabId, { view: update(current.view) });
}

/** Quien guarda el archivo del diagrama (diagram-file.ts): se enchufa aquí para no importarse en círculo. */
let onFileChange: ((tabId: string) => void) | null = null;

export function setDiagramFileListener(listener: (tabId: string) => void): void {
  onFileChange = listener;
}

/** ¿El diagrama de esta pestaña ya vive en un archivo del espacio de trabajo? */
export function diagramFilePath(tabId: string): string | undefined {
  return useWorkbenchStore.getState().tabs.find((t) => t.id === tabId)?.path;
}

/**
 * Guarda las posiciones movidas a mano: en el archivo del diagrama si ya existe (se guarda solo) y, si no,
 * en el estado persistente de la interfaz.
 */
export function setManualPositions(tabId: string, key: string, manual: ManualPositions): void {
  patchDiagram(tabId, { manual });
  if (!diagramFilePath(tabId)) useUiStore.getState().setDiagramPositions(key, manual);
  onFileChange?.(tabId);
}

/** Crea el estado de la pestaña y pide el diagrama. */
export function startDiagram(tabId: string, scope: DiagramScopeRef): void {
  const focus = useWorkbenchStore.getState().tabs.find((t) => t.id === tabId)?.diagramFocus;
  useDiagramStore.setState((s) => ({ byTab: { ...s.byTab, [tabId]: LOADING_STATE(scope.key, focus) } }));
  const path = diagramFilePath(tabId);
  if (path) {
    void loadDiagramFile(tabId, path).then((ok) => {
      // La copia guardada se actualiza sola si la conexión ya está abierta (sin pedir contraseñas ni abrir conexiones).
      if (ok && useConnectionsStore.getState().status[scope.connectionId]?.state === 'connected') {
        void loadDiagram(tabId, scope, { silent: true });
      }
    });
  } else void loadDiagram(tabId, scope);
}

/** Dibuja un archivo de diagrama: usa la copia guardada, sin consultar la base. */
async function loadDiagramFile(tabId: string, path: string): Promise<boolean> {
  const r = await window.api.fs.readScript({ path });
  const fail = (message: string): false => {
    patchDiagram(tabId, { load: { status: 'error', message } });
    return false;
  };
  if (!r.ok) return fail(r.error.message);
  const parsed = parseDiagramFile(r.data.content);
  if (!parsed.ok) return fail(parsed.reason);
  const { file } = parsed;
  patchDiagram(tabId, {
    origin: file.connection,
    manual: file.positions,
    ...loadedPatch(tabId, { tables: file.tables, relations: file.relations }, file.positions),
  });
  return true;
}

export function forgetDiagram(tabId: string): void {
  useDiagramStore.setState((s) => ({ byTab: withoutKey(s.byTab, tabId) }));
}

/** Última petición por pestaña: una respuesta atrasada no pisa a una más reciente. */
const latestRequest = new Map<string, number>();
let requestCounter = 0;

/** Pide el diagrama al servidor. "Actualizar" y "Reintentar" repiten esta llamada conservando las posiciones. */
export async function loadDiagram(
  tabId: string,
  scope: DiagramScopeRef,
  options: { silent?: boolean } = {},
): Promise<void> {
  const mine = ++requestCounter;
  latestRequest.set(tabId, mine);
  // Si ya hay un diagrama dibujado se sigue mostrando mientras llega el nuevo (no parpadea).
  const showing = diagramState(tabId).load.status === 'ready';
  if (!showing) patchDiagram(tabId, { load: { status: 'loading' } });
  const fail = (message: string): void => {
    if (latestRequest.get(tabId) !== mine) return;
    // Una actualización silenciosa que falla deja la copia guardada tal cual.
    if (options.silent && showing) return;
    patchDiagram(tabId, { load: { status: 'error', message } });
  };
  if (!(await ensureConnected(scope.connectionId))) return fail(es.diagram.unavailable);
  const r = await window.api.meta.diagram({
    connectionId: scope.connectionId,
    database: scope.database,
    schema: scope.schema,
  });
  if (latestRequest.get(tabId) !== mine) return;
  if (!r.ok) return fail(r.error.message);

  const patch = loadedPatch(tabId, r.data, diagramState(tabId).manual);
  if (patch.manual) {
    if (diagramFilePath(tabId)) onFileChange?.(tabId);
    else useUiStore.getState().setDiagramPositions(scope.key, patch.manual);
  }
  patchDiagram(tabId, patch);
  // Se guarda en el archivo del diagrama: si aún no existe se crea ahora, como un script nuevo.
  onFileChange?.(tabId);
}

/** Estado de la pestaña con el diagrama ya disponible (de la base o de un archivo). */
function loadedPatch(
  tabId: string,
  diagram: SchemaDiagram,
  positions: ManualPositions,
): Partial<DiagramTabState> {
  const current = diagramState(tabId);
  // Se descartan las posiciones de tablas que ya no existen (specs/13 §5).
  const names = new Set(diagram.tables.map((t) => t.name));
  const kept = Object.fromEntries(Object.entries(positions).filter(([name]) => names.has(name)));
  const patch: Partial<DiagramTabState> = { load: { status: 'ready', diagram } };
  if (Object.keys(kept).length !== Object.keys(positions).length) patch.manual = kept;
  // Esquema grande: se pide elegir las tablas antes de dibujar.
  if (diagram.tables.length > MAX_TABLES) {
    const stillThere = current.chosen && [...current.chosen].filter((n) => names.has(n));
    if (stillThere && stillThere.length > 0) patch.chosen = new Set(stillThere);
    else {
      patch.chosen = null;
      patch.draft = initialSelection(diagram, current.focus);
    }
  } else {
    patch.chosen = null;
    patch.draft = null;
  }
  return patch;
}
