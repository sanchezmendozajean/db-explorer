import { createElement } from 'react';
import { es } from '../../i18n/es';
import { DIAGRAM_CSS, DiagramContent, resolveCssVariables } from './DiagramContent';
import type { DiagramModel, Positions } from './diagram-layout';
import { contentBounds } from './diagram-layout';

/**
 * SVG independiente con el diagrama completo (no solo lo visible), con los colores del tema actual
 * y el texto como texto (specs/13 §5). La misma `DiagramContent` que dibuja la pantalla lo genera.
 */
export async function buildDiagramSvg(model: DiagramModel, positions: Positions): Promise<string> {
  // Se carga bajo demanda: solo hace falta al exportar.
  const { renderToStaticMarkup } = await import('react-dom/server');
  const bounds = contentBounds(model, positions);
  const css = resolveCssVariables(DIAGRAM_CSS, getComputedStyle(document.documentElement));
  const body = renderToStaticMarkup(createElement(DiagramContent, { model, positions }));
  const w = Math.ceil(bounds.width);
  const h = Math.ceil(bounds.height);
  const label = es.diagram.canvasLabel;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${bounds.x} ${bounds.y} ${w} ${h}" role="img" aria-label="${label}">`,
    `<style>${css}</style>`,
    `<rect class="er-canvas" x="${bounds.x}" y="${bounds.y}" width="${w}" height="${h}"/>`,
    body,
    '</svg>',
    '',
  ].join('\n');
}
