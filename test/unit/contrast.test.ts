import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contraste de los tokens de color (M9, revisión de accesibilidad): texto
 * 4,5:1 y los indicadores (foco, íconos de estado) 3:1, según WCAG 2.1 AA.
 * Excepción documentada en NOTAS: los bordes de los campos conservan el
 * aspecto de VS Code (el campo se distingue por su fondo y su etiqueta).
 */

const css = readFileSync(join(__dirname, '../../src/renderer/theme/tokens.css'), 'utf8');

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const SURFACES = [
  'bg-editor',
  'bg-side-bar',
  'bg-panel',
  'bg-status-bar',
  'bg-input',
  'bg-menu',
  'bg-hover',
  'bg-grid-header',
  'bg-grid-row-alt',
  'bg-selection',
  'bg-selection-inactive',
  'bg-cell-edited',
  'bg-row-deleted',
  'bg-row-inserted',
  'bg-button-secondary',
];
const MAIN = ['bg-editor', 'bg-side-bar', 'bg-panel', 'bg-menu', 'bg-input', 'bg-hover'];
const GRID = ['bg-editor', 'bg-grid-row-alt', 'bg-selection', 'bg-selection-inactive'];

/** [primer plano, fondos, mínimo]. */
const RULES: [string, string[], number][] = [
  ['fg', SURFACES, 4.5],
  ['fg-muted', SURFACES, 4.5],
  ['fg-section', ['bg-editor'], 4.5],
  ['fg-null', GRID, 4.5],
  ['error', MAIN, 4.5],
  ['warning', ['bg-editor', 'bg-panel', 'bg-side-bar'], 3],
  ['success', ['bg-editor', 'bg-panel', 'bg-side-bar'], 3],
  ['border-focus', ['bg-editor', 'bg-side-bar', 'bg-panel', 'bg-input', 'bg-menu'], 3],
  ['accent', ['bg-editor', 'bg-side-bar', 'bg-panel'], 3],
];

describe.each([
  ['oscuro', ":root[data-theme='dark']"],
  ['claro', ":root[data-theme='light']"],
])('contraste del tema %s', (_name, selector) => {
  const t = tokens(selector);

  it.each(RULES)('%s sobre sus fondos', (fg, backgrounds, min) => {
    const failures = backgrounds
      .map((bg) => ({ bg, r: ratio(t[fg]!, t[bg]!) }))
      .filter(({ r }) => r < min)
      .map(({ bg, r }) => `${bg}: ${r.toFixed(2)}`);
    expect(failures).toEqual([]);
  });

  it('texto sobre los botones primarios y la status bar de Producción', () => {
    expect(ratio(t['accent-fg']!, t['accent']!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t['status-prod-fg']!, t['status-prod-bg']!)).toBeGreaterThanOrEqual(4.5);
  });
});

it('el tema claro usa warning legible como texto (avisos del plan)', () => {
  const t = tokens(":root[data-theme='light']");
  expect(ratio(t['warning']!, t['bg-editor']!)).toBeGreaterThanOrEqual(4.5);
});
