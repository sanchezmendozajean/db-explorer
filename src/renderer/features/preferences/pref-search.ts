/** Texto sin tildes y en minúsculas (buscar "codificacion" encuentra "codificación"). */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** ¿Coincide una preferencia con la búsqueda? Todas las palabras deben aparecer en alguno de sus textos. */
export function matchesSearch(query: string, texts: (string | undefined)[]): boolean {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeText(texts.filter(Boolean).join(' '));
  return words.every((w) => haystack.includes(w));
}

/** Entero dentro de un rango, o `null` si el texto no lo es (campos numéricos de Preferencias). */
export function intInRange(text: string, min: number, max: number): number | null {
  const n = Number(text);
  return text.trim() !== '' && Number.isInteger(n) && n >= min && n <= max ? n : null;
}
