/// <reference types="vite/client" />
import type { DbExplorerApi } from '@shared/api';

declare global {
  /** Versión de `package.json`, inyectada por Vite. */
  const __APP_VERSION__: string;

  interface Window {
    api: DbExplorerApi;
  }
}

export {};
