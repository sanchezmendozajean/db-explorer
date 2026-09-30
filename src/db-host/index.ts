/**
 * Punto de entrada del proceso db-host (utilityProcess).
 * Aquí correrán todos los drivers de BD, aislados del proceso principal.
 */
import { createHandlers, dispatch } from './handlers';

const port = process.parentPort;
const handlers = createHandlers(Date.now());

port.on('message', (event) => {
  void dispatch(event.data, handlers).then((response) => {
    if (response) port.postMessage(response);
  });
});

port.postMessage({ kind: 'ready' });
