import { utilityProcess } from 'electron';
import { join } from 'node:path';
import type { DbHostTransport } from './db-host-client';

/** Lanza el db-host como `utilityProcess` y lo adapta a `DbHostTransport`. */
export function createUtilityTransport(): DbHostTransport {
  const child = utilityProcess.fork(join(__dirname, 'db-host.js'), [], {
    serviceName: 'DB Explorer - DB Host',
    stdio: 'inherit',
  });
  return {
    postMessage: (message) => child.postMessage(message),
    onMessage: (listener) => child.on('message', listener),
    onExit: (listener) => child.on('exit', listener),
    kill: () => {
      child.kill();
    },
  };
}
