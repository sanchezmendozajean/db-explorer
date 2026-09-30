/** Coincidencia difusa simple estilo quick-open de VS Code. Módulo puro. */

export interface FuzzyMatch {
  score: number;
  /** Rangos [inicio, fin) de caracteres coincidentes, para resaltarlos. */
  ranges: [number, number][];
}

/**
 * Busca `query` en `text` sin distinguir mayúsculas. Prefiere subcadenas
 * contiguas (más puntaje si están al inicio o tras un separador) y, si no
 * hay, acepta subsecuencias. Devuelve `null` si no coincide.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, ranges: [] };
  const t = text.toLowerCase();

  const index = t.indexOf(q);
  if (index >= 0) {
    const atBoundary = index === 0 || /[\s_\-.\\/:>›]/.test(t[index - 1]!) || isCaseBoundary(text, index);
    const score =
      1000 - index + (atBoundary ? 200 : 0) + (index === 0 ? 100 : 0) - (t.length - q.length) * 0.1;
    return { score, ranges: [[index, index + q.length]] };
  }

  const ranges: [number, number][] = [];
  let ti = 0;
  let score = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === found) {
      last[1] = found + 1;
      score += 5;
    } else {
      ranges.push([found, found + 1]);
      score += isCaseBoundary(text, found) || found === 0 ? 3 : 1;
    }
    ti = found + 1;
  }
  return { score: score - ranges.length * 2, ranges };
}

function isCaseBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const prev = text[index - 1]!;
  const cur = text[index]!;
  return prev === prev.toLowerCase() && cur !== cur.toLowerCase();
}
