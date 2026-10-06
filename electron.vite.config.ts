import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Política de seguridad de contenido del renderer (ver specs/08).
 * En desarrollo se relaja lo mínimo para que funcionen el HMR de Vite
 * (script inline del preámbulo de React Refresh y websocket local).
 */
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const DEV_CSP = PROD_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace(
  "connect-src 'self'",
  "connect-src 'self' ws://localhost:* http://localhost:*",
);

function cspPlugin(): Plugin {
  let isDev = false;
  return {
    name: 'db-explorer-csp',
    configResolved(config) {
      isDev = config.command === 'serve';
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: isDev ? DEV_CSP : PROD_CSP },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

const appVersion = (JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }).version;

const sharedAlias = { '@shared': resolve('src/shared') };

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'db-host': resolve('src/db-host/index.ts'),
        },
      },
    },
  },
  preload: {
    resolve: { alias: sharedAlias },
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: [
        { find: '@shared', replacement: resolve('src/shared') },
        { find: '@renderer', replacement: resolve('src/renderer') },
        // Monaco declara su propia fuente "codicon"; se usa la de la app para no tener dos versiones.
        {
          find: /^.*\/codicons\/codicon\/codicon\.css$/,
          replacement: resolve('src/renderer/features/editor/monaco/empty.css'),
        },
      ],
    },
    plugins: [react(), cspPlugin()],
    define: { __APP_VERSION__: JSON.stringify(appVersion) },
    build: {
      // Menos JavaScript que leer al arrancar (electron-vite no minifica por defecto).
      minify: true,
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') },
      },
    },
  },
});
