/// <reference types="vite/client" />
import type { DbExplorerApi } from '@shared/api';

declare global {
  interface Window {
    api: DbExplorerApi;
  }
}

export {};
