import type { KeyboardEvent, PointerEvent } from 'react';
import { es } from '../../i18n/es';
import type { DiagramModel, Positions, Route } from './diagram-layout';
import {
  BOX_WIDTH,
  HEADER_HEIGHT,
  ROW_HEIGHT,
  crowsFoot,
  fitText,
  oneBar,
  pathOf,
  routeEdge,
} from './diagram-layout';

/**
 * Estilo del diagrama ER. Se usa tal cual dentro del `<svg>` en pantalla (con `var(--…)` del tema) y,
 * con las variables ya resueltas, en el archivo SVG exportado: así el dibujo sale igual en ambos sitios.
 */
export const DIAGRAM_CSS = `
.er-canvas { fill: var(--bg-editor); }
.er-box rect.er-frame { fill: var(--bg-panel); stroke: var(--border-menu); stroke-width: 1; }
.er-box rect.er-head { fill: var(--bg-grid-header); }
.er-box .er-name { fill: var(--fg); font-weight: 600; }
.er-box .er-col { fill: var(--fg); }
.er-box .er-type { fill: var(--fg-muted); }
.er-box .er-pk { fill: var(--warning); font-weight: 700; }
.er-box .er-fk { fill: var(--link); font-weight: 700; }
.er-box .er-null { fill: var(--fg-muted); }
.er-box.is-external rect.er-frame { stroke-dasharray: 4 3; }
.er-box.is-external { opacity: 0.65; }
.er-box.is-active rect.er-frame { stroke: var(--diagram-highlight); stroke-width: 2; }
.er-box.is-active rect.er-head { fill: var(--diagram-highlight); }
.er-box.is-active .er-name { fill: #ffffff; }
.er-box:focus { outline: none; }
.er-box:focus-visible rect.er-frame { stroke: var(--border-focus); stroke-width: 2; }
.er-edge path.er-line { fill: none; stroke: var(--fg-muted); stroke-width: 1.2; }
.er-edge path.er-mark { fill: none; stroke: var(--fg-muted); stroke-width: 1.2; }
.er-edge circle.er-optional { stroke: var(--fg-muted); stroke-width: 1.2; }
.er-edge circle.er-optional.is-required { fill: var(--fg-muted); }
.er-edge circle.er-optional.is-nullable { fill: var(--bg-editor); }
.er-edge path.er-hit { fill: none; stroke: transparent; stroke-width: 10; }
.er-edge.is-active path.er-line, .er-edge.is-active path.er-mark { stroke: var(--accent); stroke-width: 2; }
.er-edge.is-active circle.er-optional { stroke: var(--accent); }
.er-edge.is-active circle.er-optional.is-required { fill: var(--accent); }
.er-text { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 12px; }
.er-pk, .er-fk { font-size: 9px; }
`;

/** Resuelve `var(--token)` con los valores actuales del tema, para el SVG exportado. */
export function resolveCssVariables(css: string, style: CSSStyleDeclaration): string {
  return css.replace(/var\((--[a-z0-9-]+)\)/gi, (_m, name: string) => style.getPropertyValue(name).trim());
}

/** Ancho medio aproximado de un carácter de 12 px, para recortar sin medir el texto. */
const CHAR_WIDTH = 6.6;
const LABELS_WIDTH = 40;

export interface DiagramContentProps {
  model: DiagramModel;
  positions: Positions;
  /** Caja resaltada por el cursor o el teclado. */
  activeBox?: string | null;
  /** Línea resaltada por el cursor. */
  activeEdge?: string | null;
  /** Solo en pantalla: eventos y foco. El SVG exportado no los lleva. */
  interactive?: boolean;
  onBoxPointerDown?: (e: PointerEvent<SVGGElement>, id: string) => void;
  onBoxKeyDown?: (e: KeyboardEvent<SVGGElement>, id: string) => void;
  onBoxDoubleClick?: (id: string) => void;
  onBoxHover?: (id: string | null) => void;
  onEdgeHover?: (id: string | null) => void;
}

/** Dibujo del diagrama: primero las líneas, encima las cajas. Lo comparten la pantalla y la exportación. */
export function DiagramContent(props: DiagramContentProps): React.JSX.Element {
  const { model, positions, activeBox, activeEdge, interactive } = props;
  const boxes = new Map(model.boxes.map((b) => [b.id, b]));
  const routes = new Map<string, Route>();
  for (const e of model.edges) {
    const route = routeEdge(e, boxes, positions);
    if (route) routes.set(e.id, route);
  }

  // Lo relacionado con la caja o la línea activa queda normal; lo demás se atenúa.
  const focusEdges = new Set<string>();
  const focusBoxes = new Set<string>();
  if (activeBox) {
    focusBoxes.add(activeBox);
    for (const e of model.edges) {
      if (e.from === activeBox || e.to === activeBox) {
        focusEdges.add(e.id);
        focusBoxes.add(e.from);
        focusBoxes.add(e.to);
      }
    }
  } else if (activeEdge) {
    const e = model.edges.find((x) => x.id === activeEdge);
    if (e) {
      focusEdges.add(e.id);
      focusBoxes.add(e.from);
      focusBoxes.add(e.to);
    }
  }
  // Solo la caja activa (cursor, teclado o selección) se resalta; las demás no se atenúan.
  const highlighted = activeBox ? new Set([activeBox]) : new Set(focusBoxes);

  return (
    <>
      <g className="er-edges">
        {model.edges.map((e) => {
          const route = routes.get(e.id);
          if (!route) return null;
          const d = pathOf(route.points);
          const active = focusEdges.has(e.id);
          const title = es.diagram.relationTitle(e.name, e.from, boxes.get(e.to)?.label ?? e.to);
          return (
            <g
              key={e.id}
              className={['er-edge', active ? 'is-active' : ''].filter(Boolean).join(' ')}
              data-edge={e.id}
              onPointerEnter={interactive ? () => props.onEdgeHover?.(e.id) : undefined}
              onPointerLeave={interactive ? () => props.onEdgeHover?.(null) : undefined}
            >
              <title>{title}</title>
              <path className="er-hit" d={d} />
              <path className="er-line" d={d} />
              <path className="er-mark" d={crowsFoot(route.fkEnd)} />
              <path className="er-mark" d={oneBar(route.refEnd)} />
              <circle
                className={`er-optional ${e.optional ? 'is-nullable' : 'is-required'}`}
                cx={route.fkEnd.x + route.fkEnd.dir * 18}
                cy={route.fkEnd.y}
                r={3.5}
              />
            </g>
          );
        })}
      </g>
      <g className="er-boxes">
        {model.boxes.map((b) => {
          const p = positions[b.id];
          if (!p) return null;
          const classes = [
            'er-box',
            b.external ? 'is-external' : '',
            highlighted.has(b.id) ? 'is-active' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <g
              key={b.id}
              className={classes}
              transform={`translate(${p.x} ${p.y})`}
              data-box={b.id}
              {...(interactive
                ? {
                    tabIndex: 0,
                    role: 'group',
                    'aria-label': es.diagram.boxLabel(b.label, b.columns.length),
                    onPointerDown: (e: PointerEvent<SVGGElement>) => props.onBoxPointerDown?.(e, b.id),
                    onKeyDown: (e: KeyboardEvent<SVGGElement>) => props.onBoxKeyDown?.(e, b.id),
                    onDoubleClick: () => props.onBoxDoubleClick?.(b.id),
                    onPointerEnter: () => props.onBoxHover?.(b.id),
                    onPointerLeave: () => props.onBoxHover?.(null),
                    onFocus: () => props.onBoxHover?.(b.id),
                    onBlur: () => props.onBoxHover?.(null),
                  }
                : {})}
            >
              {b.external && <title>{es.diagram.externalTable}</title>}
              <rect className="er-frame" width={BOX_WIDTH} height={b.height} rx={4} />
              <rect className="er-head" width={BOX_WIDTH} height={HEADER_HEIGHT} rx={4} />
              <text className="er-text er-name" x={10} y={HEADER_HEIGHT / 2 + 4.5} data-box-header>
                {fitText(b.label, Math.floor((BOX_WIDTH - 20) / CHAR_WIDTH))}
              </text>
              {b.columns.map((c, i) => {
                const y = HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2 + 4;
                const type = fitText(c.nativeType, 16);
                const nameMax = Math.floor(
                  (BOX_WIDTH - LABELS_WIDTH - 8 - type.length * 6.2 - 8) / CHAR_WIDTH,
                );
                return (
                  <g key={c.name}>
                    {c.primaryKey && (
                      <text className="er-text er-pk" x={6} y={y}>
                        PK
                      </text>
                    )}
                    {c.foreignKey && (
                      <text className="er-text er-fk" x={22} y={y}>
                        FK
                      </text>
                    )}
                    <text className="er-text er-col" x={LABELS_WIDTH} y={y}>
                      {fitText(c.name, nameMax)}
                    </text>
                    <text className="er-text er-type" x={BOX_WIDTH - 8} y={y} textAnchor="end">
                      {type}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </g>
    </>
  );
}
