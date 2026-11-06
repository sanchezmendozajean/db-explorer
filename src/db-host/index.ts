/**
 * Punto de entrada del proceso db-host (utilityProcess).
 * Aquí corren todos los drivers de BD, aislados del proceso principal.
 */
import { ConnectionManager } from './connection-manager';
import { defaultDriverFactory } from './connection-manager';
import { createHandlers, dispatch } from './handlers';
import { watchSuspension } from './suspension-watch';

const port = process.parentPort;
const connections = new ConnectionManager(defaultDriverFactory, (event) =>
  port.postMessage({ kind: 'query-event', event }),
);
const handlers = createHandlers(Date.now(), Date.now, connections);

// Tras suspender el equipo las conexiones de las sesiones pueden estar muertas: se comprueban al ejecutar.
watchSuspension(() => connections.queries.markStale());

port.on('message', (event) => {
  void dispatch(event.data, handlers).then((response) => {
    if (response) port.postMessage(response);
  });
});

port.postMessage({ kind: 'ready' });
