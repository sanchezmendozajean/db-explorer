/**
 * Detecta que el equipo estuvo suspendido: un temporizador regular que de pronto "llega tarde" según el
 * reloj de pared (el reloj monótono de los temporizadores se detiene mientras el equipo duerme, el de
 * pared no). Al reanudar, las conexiones TCP pudieron morir sin aviso.
 *
 * Devuelve la función que detiene la vigilancia.
 */
export function watchSuspension(
  onResume: () => void,
  options: { intervalMs?: number; gapMs?: number; wallClock?: () => number } = {},
): () => void {
  const intervalMs = options.intervalMs ?? 5000;
  const gapMs = options.gapMs ?? 20_000;
  const wallClock = options.wallClock ?? Date.now;
  let last = wallClock();
  const timer = setInterval(() => {
    const current = wallClock();
    if (current - last > gapMs) onResume();
    last = current;
  }, intervalMs);
  // No debe mantener vivo el proceso.
  timer.unref();
  return () => clearInterval(timer);
}
