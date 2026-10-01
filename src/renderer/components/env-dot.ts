import type { CSSProperties } from 'react';

/**
 * Estilo del punto de color de una conexión: relleno cuando está conectada y
 * hueco (solo el borde, clase `is-hollow`) cuando está cerrada.
 */
export function dotStyle(color: string): CSSProperties {
  return { background: color, ['--dot-color' as string]: color };
}
