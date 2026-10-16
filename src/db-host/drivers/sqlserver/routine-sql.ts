/**
 * `OBJECT_DEFINITION` devuelve el `CREATE PROCEDURE/FUNCTION` original. Para guardar una rutina
 * existente se cambia ese primer `CREATE` (o `CREATE OR ALTER`) por `ALTER`, que conserva permisos
 * y dependencias. Si el texto ya empieza con `ALTER`, queda igual.
 */
const HEADER = /\b(?:CREATE\s+OR\s+ALTER|CREATE|ALTER)\s+(PROCEDURE|PROC|FUNCTION)\b/i;

/** Devuelve la definición con su primera sentencia como `ALTER`, o `null` si no es una rutina. */
export function toAlterStatement(definition: string): string | null {
  const match = HEADER.exec(definition);
  if (!match) return null;
  return `${definition.slice(0, match.index)}ALTER ${match[1]}${definition.slice(match.index + match[0].length)}`;
}

/**
 * `toAlterStatement` junto con la correspondencia de posiciones: el servidor informa los errores
 * sobre el texto con `ALTER`, pero el editor muestra el original (`CREATE`, `CREATE OR ALTER`).
 */
export function toAlterWithMap(
  definition: string,
): { sql: string; toOriginal: (position: number | undefined) => number | undefined } | null {
  const match = HEADER.exec(definition);
  if (!match) return null;
  const replacement = `ALTER ${match[1]}`;
  const sql = `${definition.slice(0, match.index)}${replacement}${definition.slice(match.index + match[0].length)}`;
  const shift = match[0].length - replacement.length;
  const boundary = match.index + replacement.length;
  return {
    sql,
    // Posición 1-based: lo que está después del encabezado se corre lo que cambió su largo.
    toOriginal: (position) =>
      position === undefined || position - 1 < boundary ? position : position + shift,
  };
}
