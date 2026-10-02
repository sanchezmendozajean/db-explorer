/** Copia de un objeto sin una clave (en lugar de `delete obj[clave]`). */
export function withoutKey<T>(record: Readonly<Record<string, T>>, key: string | number): Record<string, T>;
export function withoutKey<T>(record: Readonly<Record<number, T>>, key: number): Record<number, T>;
export function withoutKey<T>(
  record: Readonly<Record<string | number, T>>,
  key: string | number,
): Record<string, T> {
  const k = String(key);
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== k));
}
