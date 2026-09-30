/**
 * Textos de la interfaz en español. Todo texto visible debe salir de aquí.
 */
export const es = {
  app: {
    name: 'DB Explorer',
    subtitle: 'Esqueleto de la aplicación (hito M0)',
  },
  ping: {
    title: 'Comunicación con el proceso de base de datos',
    pending: 'Enviando ping al db-host…',
    success: 'El db-host respondió',
    failure: 'El db-host no respondió',
    retry: 'Enviar ping de nuevo',
    echo: 'Respuesta',
    pid: 'PID del db-host',
    roundTrip: 'Ida y vuelta',
    uptime: 'Tiempo activo del db-host',
    electron: 'Electron',
    node: 'Node',
    message: 'ping',
  },
  dbHost: {
    restarted: 'Conexiones reiniciadas: el proceso de base de datos se reinició',
  },
  units: {
    ms: (value: number) => `${value.toLocaleString('es')} ms`,
  },
} as const;

export type Strings = typeof es;
