import type { Engine } from '@shared/connection';
import { es } from '../../i18n/es';
import { connectionById } from '../../stores/connections-store';
import type { EditorTab } from '../../stores/workbench-store';
import { useWorkbenchStore } from '../../stores/workbench-store';
import { ensureConnected } from '../connections/actions';
import { findDiagramFile, openDiagramFile } from './diagram-file';

/**
 * Motores con diagrama ER ya construido (hito M10, motor por motor). Quitar de aquí el motor que falte
 * cuando su driver implemente `getSchemaDiagram`.
 */
export const DIAGRAM_ENGINES: readonly Engine[] = ['sqlite'];

export function supportsDiagram(engine: Engine | undefined): boolean {
  return !!engine && DIAGRAM_ENGINES.includes(engine);
}

export interface DiagramScope {
  database: string;
  schema: string;
}

/** Clave estable de un diagrama (conexión + base + esquema): identifica la pestaña y sus posiciones guardadas. */
export function diagramKey(connectionId: string, scope: DiagramScope): string {
  return `${connectionId}\u0000${scope.database}\u0000${scope.schema}`;
}

export function diagramTabId(connectionId: string, scope: DiagramScope): string {
  return `diagram:${diagramKey(connectionId, scope)}`;
}

/** Pestaña de diagrama ya abierta para ese esquema (sin archivo o abierta desde su archivo). */
function openTabFor(connectionId: string, scope: DiagramScope): EditorTab | undefined {
  return useWorkbenchStore
    .getState()
    .tabs.find(
      (t) =>
        t.kind === 'diagram' &&
        t.connectionId === connectionId &&
        t.database === scope.database &&
        t.schema === scope.schema,
    );
}

function focusTab(tab: EditorTab, focus: string | undefined): void {
  const wb = useWorkbenchStore.getState();
  wb.update(tab.id, { diagramFocus: focus });
  wb.activate(tab.id);
}

/**
 * Abre (o enfoca) el diagrama de un esquema; con `focus` selecciona y centra esa tabla (specs/13 §1).
 * Como un script nuevo, el diagrama se guarda en el espacio de trabajo al abrirlo: si ya hay un archivo de
 * ese esquema se reabre (y se actualiza desde la base), y si no, se crea uno al cargar.
 */
export async function openDiagramTab(
  connectionId: string,
  scope: DiagramScope,
  focus?: string,
): Promise<void> {
  const conn = connectionById(connectionId);
  if (!conn) return;
  const open = openTabFor(connectionId, scope);
  if (open) return focusTab(open, focus);

  // Se conecta primero: si había un archivo guardado, se actualiza desde la base al abrirlo.
  await ensureConnected(connectionId);
  const path = await findDiagramFile(connectionId, scope);
  // Pudo abrirse mientras se buscaba (doble clic en el menú).
  const raced = openTabFor(connectionId, scope);
  if (raced) return focusTab(raced, focus);
  if (path) {
    await openDiagramFile(path, focus);
    return;
  }
  const crumbs = [
    conn.name,
    ...(conn.engine === 'sqlite' ? [] : [scope.database]),
    ...(conn.engine === 'postgres' || conn.engine === 'sqlserver' ? [scope.schema] : []),
  ];
  const title = conn.engine === 'sqlite' ? conn.name : scope.schema;
  useWorkbenchStore.getState().open({
    id: diagramTabId(connectionId, scope),
    kind: 'diagram',
    title: es.diagram.tabTitle(title),
    tooltip: crumbs.join(' › '),
    connectionId,
    database: scope.database,
    schema: scope.schema,
    dirty: false,
    preview: false,
    diagramFocus: focus,
  });
}
