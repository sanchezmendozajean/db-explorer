import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { SchemaDiagram } from '@shared/metadata';
import { Button, IconButton } from '../../components/Button';
import { Codicon } from '../../components/Codicon';
import { es } from '../../i18n/es';
import { connectionById } from '../../stores/connections-store';
import { useFilesStore } from '../../stores/files-store';
import { useToastStore } from '../../stores/toast-store';
import { useUiStore } from '../../stores/ui-store';
import type { EditorTab } from '../../stores/workbench-store';
import { openObjectTab } from '../objects/object-tabs';
import { DIAGRAM_CSS, DiagramContent } from './DiagramContent';
import type { DiagramActions } from './diagram-actions';
import { focusDiagram, registerDiagram, unregisterDiagram } from './diagram-actions';
import { buildDiagramSvg } from './diagram-export';
import type { Positions } from './diagram-layout';
import {
  BOX_WIDTH,
  MAX_TABLES,
  autoLayout,
  buildModel,
  contentBounds,
  initialSelection,
} from './diagram-layout';
import type { ManualPositions } from './diagram-store';
import {
  EMPTY_DIAGRAM_STATE,
  diagramState,
  forgetDiagram,
  loadDiagram,
  patchDiagram,
  setDiagramView,
  setManualPositions,
  startDiagram,
  useDiagramStore,
} from './diagram-store';
import { flushDiagramSave } from './diagram-file';
import { diagramKey } from './diagram-tabs';

const t = es.diagram;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const ZOOM_STEP = 1.2;
const KEY_STEP = 10;
const KEY_STEP_BIG = 50;
/** Cuánto debe moverse el puntero para que el gesto sea un arrastre y no un clic. */
const DRAG_THRESHOLD = 3;

const clampZoom = (k: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** Acerca o aleja manteniendo fijo el punto (`cx`, `cy`) del lienzo. */
function zoomAt(tabId: string, cx: number, cy: number, factor: number): void {
  setDiagramView(tabId, (v) => {
    const k = clampZoom(v.k * factor);
    const ratio = k / v.k;
    return { k, x: cx - (cx - v.x) * ratio, y: cy - (cy - v.y) * ratio };
  });
}

/** Pestaña de diagrama ER (specs/13): cajas movibles, zoom, posiciones recordadas y exportación a SVG. */
export function DiagramView({ tab }: { tab: EditorTab }): React.JSX.Element {
  const conn = connectionById(tab.connectionId);
  // Un diagrama abierto desde un archivo se dibuja aunque su conexión ya no exista.
  const [fromFile] = useState(() => Boolean(tab.path));
  const connectionId = tab.connectionId ?? '';
  const database = tab.database ?? '';
  const schema = tab.schema ?? '';
  const key = diagramKey(connectionId, { database, schema });
  const scope = { connectionId, database, schema, key };
  const tabId = tab.id;

  const st = useDiagramStore((s) => s.byTab[tabId]) ?? EMPTY_DIAGRAM_STATE;
  const { load, chosen, draft, manual, view, selected } = st;
  const [hoverBox, setHoverBox] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const pan = useRef<{ startX: number; startY: number; viewX: number; viewY: number } | null>(null);

  // Al abrir se pide el diagrama; al cerrar la pestaña se libera su estado.
  useEffect(() => {
    if (connectionById(connectionId) || fromFile)
      startDiagram(tabId, { connectionId, database, schema, key });
    return () => {
      flushDiagramSave(tabId);
      forgetDiagram(tabId);
      unregisterDiagram(tabId);
    };
  }, [tabId, connectionId, database, schema, key, fromFile]);

  const diagram = load.status === 'ready' ? load.diagram : null;
  const tooBig = !!diagram && diagram.tables.length > MAX_TABLES;

  const shown = useMemo<SchemaDiagram | null>(() => {
    if (!diagram) return null;
    if (!tooBig) return diagram;
    if (!chosen) return null;
    return { tables: diagram.tables.filter((x) => chosen.has(x.name)), relations: diagram.relations };
  }, [diagram, tooBig, chosen]);

  const model = useMemo(() => (shown ? buildModel(shown, schema) : null), [shown, schema]);
  const auto = useMemo(() => (model ? autoLayout(model) : {}), [model]);
  const positions = useMemo<Positions>(() => {
    const merged: Positions = { ...auto };
    for (const [name, [x, y]] of Object.entries(manual)) {
      if (merged[name]) merged[name] = { x, y };
    }
    return merged;
  }, [auto, manual]);

  const hostSize = (): { width: number; height: number } => {
    const rect = hostRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? 800, height: rect?.height ?? 600 };
  };

  /** Ajusta el diagrama a la ventana con las posiciones dadas. */
  const fitWith = (at: Positions): void => {
    if (!model) return;
    const { width, height } = hostSize();
    const b = contentBounds(model, at);
    const k = clampZoom(Math.min(width / b.width, height / b.height, 1));
    patchDiagram(tabId, {
      view: { k, x: -b.x * k + (width - b.width * k) / 2, y: -b.y * k + (height - b.height * k) / 2 },
    });
  };

  const fit = (): void => fitWith(positions);

  const centerOn = (id: string): void => {
    const box = model?.boxes.find((b) => b.id === id);
    const p = positions[id];
    if (!box || !p) return;
    const { width, height } = hostSize();
    const k = clampZoom(Math.max(view.k, 0.8));
    patchDiagram(tabId, {
      view: { k, x: width / 2 - (p.x + BOX_WIDTH / 2) * k, y: height / 2 - (p.y + box.height / 2) * k },
    });
  };

  const zoomCentered = (factor: number): void => {
    const { width, height } = hostSize();
    zoomAt(tabId, width / 2, height / 2, factor);
  };

  const actions: DiagramActions = {
    zoomIn: () => zoomCentered(ZOOM_STEP),
    zoomOut: () => zoomCentered(1 / ZOOM_STEP),
    fit,
  };
  // Se registra en cada dibujo para que los atajos vean siempre el modelo actual.
  useEffect(() => {
    registerDiagram(tabId, actions);
  });

  // Primera vista: la tabla pedida centrada, o todo el diagrama ajustado a la ventana.
  useEffect(() => {
    if (!model || st.placed) return;
    patchDiagram(tabId, { placed: true });
    const focus = tab.diagramFocus;
    if (focus && model.boxes.some((b) => b.id === focus)) {
      patchDiagram(tabId, { selected: focus, focus });
      centerOn(focus);
    } else fit();
  });

  // "Ver diagrama" sobre otra tabla con la pestaña ya abierta: selecciona y centra esa tabla.
  useEffect(() => {
    if (!st.placed || tab.diagramFocus === st.focus) return;
    patchDiagram(tabId, { focus: tab.diagramFocus });
    const focus = tab.diagramFocus;
    if (focus && model?.boxes.some((b) => b.id === focus)) {
      patchDiagram(tabId, { selected: focus });
      centerOn(focus);
    }
  });

  // Rueda: Ctrl acerca o aleja sobre el cursor; sin Ctrl desplaza (con Mayús, en horizontal).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      if (e.ctrlKey) {
        const rect = host.getBoundingClientRect();
        zoomAt(tabId, e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
      } else if (e.shiftKey) {
        setDiagramView(tabId, (v) => ({ ...v, x: v.x - (e.deltaY || e.deltaX) }));
      } else {
        setDiagramView(tabId, (v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [tabId]);

  const persist = (next: ManualPositions): void => setManualPositions(tabId, key, next);

  /** Descarta las posiciones movidas a mano y vuelve a la disposición automática. */
  const rearrange = (): void => {
    persist({});
    fitWith(auto);
  };

  // Arrastre de cajas y desplazamiento del lienzo: ambos terminan en `onPointerMove/Up` del svg
  // porque el elemento que captura el puntero está dentro de él.
  const onBoxPointerDown = (e: PointerEvent<SVGGElement>, id: string): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = positions[id];
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    patchDiagram(tabId, { selected: id });
    drag.current = { id, startX: e.clientX, startY: e.clientY, originX: p.x, originY: p.y, moved: false };
  };

  const onCanvasPointerDown = (e: PointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    patchDiagram(tabId, { selected: null });
    pan.current = { startX: e.clientX, startY: e.clientY, viewX: view.x, viewY: view.y };
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      d.moved = true;
      const current = diagramState(tabId);
      patchDiagram(tabId, {
        manual: {
          ...current.manual,
          [d.id]: [Math.round(d.originX + dx / current.view.k), Math.round(d.originY + dy / current.view.k)],
        },
      });
      return;
    }
    const p = pan.current;
    if (p)
      patchDiagram(tabId, {
        view: {
          ...diagramState(tabId).view,
          x: p.viewX + e.clientX - p.startX,
          y: p.viewY + e.clientY - p.startY,
        },
      });
  };

  const onPointerUp = (): void => {
    if (drag.current?.moved) persist(diagramState(tabId).manual);
    drag.current = null;
    pan.current = null;
  };

  const openTable = (id: string): void => {
    const box = model?.boxes.find((b) => b.id === id);
    if (!conn || !box || box.external) return;
    openObjectTab(connectionId, { database, schema, name: box.id, kind: 'table' }, 'data', {
      preview: false,
    });
  };

  const onBoxKeyDown = (e: KeyboardEvent<SVGGElement>, id: string): void => {
    const step = e.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = delta[e.key];
    if (move) {
      e.preventDefault();
      e.stopPropagation();
      const p = positions[id];
      if (p) persist({ ...diagramState(tabId).manual, [id]: [p.x + move[0], p.y + move[1]] });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openTable(id);
    }
  };

  const exportSvg = async (): Promise<void> => {
    if (!model || st.exporting) return;
    patchDiagram(tabId, { exporting: true });
    const toasts = useToastStore.getState();
    try {
      const svg = await buildDiagramSvg(model, positions);
      const label = !conn ? (st.origin?.name ?? schema) : conn.engine === 'sqlite' ? conn.name : schema;
      const r = await window.api.fs.saveExport({ name: `Diagrama-${label}`, extension: 'svg', content: svg });
      if (!r.ok) {
        toasts.show({ severity: 'error', message: t.exportFailed(r.error.message) });
        return;
      }
      const path = r.data.path;
      toasts.show({
        severity: 'success',
        message: t.exported(path.split(/[\\/]/).pop() ?? path),
        actions: [
          {
            label: t.showInFiles,
            run: () => {
              useUiStore.getState().showView('files');
              void useFilesStore.getState().reveal(path);
            },
          },
        ],
      });
    } catch (err) {
      toasts.show({
        severity: 'error',
        message: t.exportFailed(err instanceof Error ? err.message : String(err)),
      });
    } finally {
      patchDiagram(tabId, { exporting: false });
    }
  };

  if (!conn && !fromFile) {
    return (
      <div className="diagram-view panel-empty">
        <p>{t.unavailable}</p>
      </div>
    );
  }

  const noRelations = !!model && model.boxes.length > 0 && model.edges.length === 0;
  const picking = tooBig && !!draft && !chosen;

  return (
    <div
      className="diagram-view"
      data-focus-context="editorFocus diagramFocus"
      data-testid="diagram-view"
      tabIndex={-1}
      onFocusCapture={() => focusDiagram(tabId)}
    >
      <div className="diagram-toolbar" role="toolbar" aria-label={t.canvasLabel}>
        <span className="diagram-title">
          <Codicon name="symbol-structure" size={14} />
          {tab.title}
        </span>
        <span className="toolbar-separator" />
        <IconButton
          icon="refresh"
          label={conn ? t.refresh : t.refreshOffline}
          onClick={() => void loadDiagram(tabId, scope)}
          disabled={!conn}
        />
        <IconButton icon="layout" label={t.rearrangeTitle} onClick={rearrange} disabled={!model} />
        {tooBig && (
          <IconButton
            icon="list-filter"
            label={t.pickerChoose}
            onClick={() =>
              patchDiagram(tabId, {
                draft: chosen ?? (diagram ? initialSelection(diagram, tab.diagramFocus) : null),
                chosen: null,
              })
            }
          />
        )}
        <span className="toolbar-separator" />
        <IconButton icon="zoom-out" label={t.zoomOut} onClick={actions.zoomOut} disabled={!model} />
        <span className="diagram-zoom" aria-live="polite">
          {t.zoomLevel(Math.round(view.k * 100))}
        </span>
        <IconButton icon="zoom-in" label={t.zoomIn} onClick={actions.zoomIn} disabled={!model} />
        <IconButton icon="screen-full" label={t.fitTitle} onClick={fit} disabled={!model} />
        <span className="toolbar-separator" />
        {!conn && (
          <span className="diagram-offline" title={t.refreshOffline}>
            {t.offline}
          </span>
        )}
        <Button
          variant="secondary"
          small
          icon="desktop-download"
          title={t.exportSvgTitle}
          onClick={() => void exportSvg()}
          disabled={!model || model.boxes.length === 0 || st.exporting}
          data-testid="diagram-export"
        >
          {t.exportSvg}
        </Button>
      </div>
      <div className="diagram-body" ref={hostRef}>
        {load.status === 'loading' && (
          <div className="diagram-message" role="status">
            <Codicon name="loading" spin size={16} /> {t.loading}
          </div>
        )}
        {load.status === 'error' && (
          <div className="diagram-message" role="alert">
            <span className="diagram-error">{load.message}</span>
            <Button variant="secondary" small onClick={() => void loadDiagram(tabId, scope)}>
              {t.retry}
            </Button>
          </div>
        )}
        {picking && diagram && draft && (
          <TablePicker
            diagram={diagram}
            draft={draft}
            filter={st.filter}
            onFilter={(filter) => patchDiagram(tabId, { filter })}
            onChange={(next) => patchDiagram(tabId, { draft: next })}
            onAccept={() => patchDiagram(tabId, { chosen: draft, placed: false })}
          />
        )}
        {model && model.boxes.length === 0 && load.status === 'ready' && (
          <div className="diagram-message">{t.empty}</div>
        )}
        {model && model.boxes.length > 0 && (
          <>
            <svg
              className="diagram-svg"
              role="group"
              aria-label={t.canvasLabel}
              data-testid="diagram-svg"
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <style>{DIAGRAM_CSS}</style>
              <rect className="er-canvas" width="100%" height="100%" />
              <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                <DiagramContent
                  model={model}
                  positions={positions}
                  activeBox={hoverBox ?? selected}
                  activeEdge={hoverEdge}
                  interactive
                  onBoxPointerDown={onBoxPointerDown}
                  onBoxKeyDown={onBoxKeyDown}
                  onBoxDoubleClick={openTable}
                  onBoxHover={setHoverBox}
                  onEdgeHover={setHoverEdge}
                />
              </g>
            </svg>
            {noRelations && <div className="diagram-notice">{t.noRelations}</div>}
          </>
        )}
      </div>
    </div>
  );
}

interface TablePickerProps {
  diagram: SchemaDiagram;
  draft: Set<string>;
  filter: string;
  onFilter: (value: string) => void;
  onChange: (next: Set<string>) => void;
  onAccept: () => void;
}

/** Selector de tablas para esquemas con más de `MAX_TABLES` (specs/13 §2.2). */
function TablePicker({
  diagram,
  draft,
  filter,
  onFilter,
  onChange,
  onAccept,
}: TablePickerProps): React.JSX.Element {
  const names = useMemo(
    () => diagram.tables.map((x) => x.name).sort((a, b) => a.localeCompare(b, 'es')),
    [diagram],
  );
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? names.filter((n) => n.toLowerCase().includes(q)) : names;
  }, [names, filter]);
  const toggle = (name: string): void => {
    const next = new Set(draft);
    if (next.has(name)) next.delete(name);
    else if (next.size < MAX_TABLES) next.add(name);
    onChange(next);
  };
  return (
    <div className="diagram-picker" role="dialog" aria-label={t.pickerTitle(MAX_TABLES, names.length)}>
      <p>{t.pickerTitle(MAX_TABLES, names.length)}</p>
      <input
        className="input"
        type="text"
        value={filter}
        placeholder={t.pickerFilter}
        aria-label={t.pickerFilter}
        onChange={(e) => onFilter(e.target.value)}
      />
      <ul className="diagram-picker-list">
        {visible.map((name) => (
          <li key={name}>
            <label>
              <input
                type="checkbox"
                checked={draft.has(name)}
                disabled={!draft.has(name) && draft.size >= MAX_TABLES}
                onChange={() => toggle(name)}
              />
              {name}
            </label>
          </li>
        ))}
      </ul>
      <div className="diagram-picker-footer">
        <span>{t.pickerSelected(draft.size, MAX_TABLES)}</span>
        <Button small onClick={onAccept} disabled={draft.size === 0}>
          {t.pickerShow}
        </Button>
      </div>
    </div>
  );
}
