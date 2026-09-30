import { app, session, shell } from 'electron';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

/** URL del servidor de desarrollo de Vite (solo en `npm run dev`). */
export const devServerUrl: string | undefined = app.isPackaged
  ? undefined
  : process.env['ELECTRON_RENDERER_URL'];

/** Ruta del HTML del renderer empaquetado. */
export const rendererIndexPath = join(__dirname, '../renderer/index.html');

/** Las DevTools solo se habilitan en desarrollo o con la bandera `--dev-tools`. */
export const devToolsEnabled = !app.isPackaged || process.argv.includes('--dev-tools');

/** Indica si una URL corresponde al renderer propio de la aplicación. */
export function isTrustedRendererUrl(url: string): boolean {
  if (devServerUrl) {
    try {
      return new URL(url).origin === new URL(devServerUrl).origin;
    } catch {
      return false;
    }
  }
  return url.split(/[?#]/)[0] === pathToFileURL(rendererIndexPath).href;
}

/** Solo se permite abrir enlaces externos con esquema https. */
export function isAllowedExternalUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Aplica las medidas de seguridad base de specs/08: bloqueo de navegación,
 * de ventanas nuevas, de webviews y de permisos.
 */
export function applySecurityPolicies(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (!isTrustedRendererUrl(url)) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => {
      if (!isTrustedRendererUrl(url)) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}
