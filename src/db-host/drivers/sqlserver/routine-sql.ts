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
