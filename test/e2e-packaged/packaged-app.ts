import { execFileSync, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { chromium } from '@playwright/test';

/** Ejecutable empaquetado (`electron-builder --dir`), o el instalado si se indica en `DBX_PACKAGED_EXE`. */
export const PACKAGED_EXE =
  process.env['DBX_PACKAGED_EXE'] ?? resolve(__dirname, '../../dist/win-unpacked/DB Explorer.exe');

/** PATH con solo carpetas de Windows: el programa no debe necesitar Node instalado. */
const WINDOWS = process.env['SystemRoot'] ?? 'C:\\Windows';
const SYSTEM_PATH = [
  WINDOWS,
  join(WINDOWS, 'System32'),
  join(WINDOWS, 'System32', 'WindowsPowerShell', 'v1.0'),
].join(';');

export interface PackagedApp {
  page: Page;
  /** Cierra la ventana como el usuario (los scripts se guardan) y espera a que termine el proceso. */
  close: () => Promise<void>;
  /** Termina el árbol de procesos (si una prueba falló a medias). */
  kill: () => void;
}

let nextPort = 9400;

/**
 * Lanza el .exe y se conecta por CDP. El lanzador de Electron de Playwright no
 * sirve aquí: necesita el inspector de Node, que el fuse
 * `EnableNodeCliInspectArguments` desactiva en el build.
 */
export async function launchPackaged(userData: string): Promise<PackagedApp> {
  const port = nextPort++;
  // Sin ELECTRON_RUN_AS_NODE y con un PATH solo de Windows (en Windows la clave puede ser 'Path').
  const inherited = Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && entry[0] !== 'ELECTRON_RUN_AS_NODE' && entry[0].toLowerCase() !== 'path',
  );
  const env = { ...Object.fromEntries(inherited), DBX_USER_DATA_DIR: userData, PATH: SYSTEM_PATH };
  const child = spawn(PACKAGED_EXE, [`--remote-debugging-port=${port}`], { env, stdio: 'ignore' });
  const exited = new Promise<void>((done) => child.once('exit', () => done()));
  let browser: Browser | undefined;
  for (let i = 0; i < 400 && !browser; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  if (!browser) throw new Error('El programa empaquetado no abrió el puerto de depuración');
  const context = browser.contexts()[0]!;
  const page = context.pages()[0] ?? (await context.waitForEvent('page'));
  await page.getByTestId('statusbar').waitFor();
  const kill = (): void => {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      // Ya terminó.
    }
  };
  return {
    page,
    kill,
    close: async () => {
      // El botón Cerrar de la barra de título propia: el mismo camino que el usuario (guarda antes de salir).
      await page
        .locator('.titlebar')
        .getByRole('button', { name: 'Cerrar', exact: true })
        .click()
        .catch(() => undefined);
      await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
      await browser.close().catch(() => undefined);
      kill();
    },
  };
}
