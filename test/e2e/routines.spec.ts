import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { launchApp, pgConfig, tempUserData } from './helpers';

/**
 * Editor de rutinas (PostgreSQL): autocompletado dentro del cuerpo `$$ … $$` con el catálogo de la
 * conexión, y marca del error en el texto cuando el motor informa la posición.
 */

const pg = pgConfig();
let app: ElectronApplication;
let page: Page;

test.describe.configure({ mode: 'serial' });

const tree = (): ReturnType<Page['locator']> => page.locator('[data-view="connections"] .tree');
const node = (name: RegExp): ReturnType<Page['locator']> => tree().getByRole('treeitem', { name });
const routine = (): ReturnType<Page['locator']> => page.getByTestId('routine-editor');
const suggest = (): ReturnType<Page['locator']> => routine().locator('.suggest-widget');

/** Reemplaza todo el texto del editor de la rutina. */
async function setText(text: string): Promise<void> {
  await routine().locator('.view-lines').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

test.beforeAll(async () => {
  app = await launchApp(tempUserData());
  page = await app.firstWindow();
  await page.getByTestId('statusbar').waitFor();
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Nueva conexión' }).first().click();
  await dialog.getByRole('button', { name: 'PostgreSQL' }).click();
  await dialog.getByLabel('Nombre', { exact: true }).fill('PG Rutinas');
  await dialog.getByLabel('Host').fill(pg.host);
  await dialog.getByLabel('Puerto').fill(String(pg.port));
  await dialog.getByLabel('Base de datos (opcional)').fill(pg.database);
  await dialog.getByLabel('Usuario').fill(pg.user);
  await dialog.getByLabel('Contraseña', { exact: true }).fill(pg.password);
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await node(/PG Rutinas/).dblclick();
  await node(new RegExp(`^${pg.database}`)).dblclick();
  await node(/^dbx$/).dblclick();
  await node(/^Funciones/).dblclick();
  await node(/^fn_doble/).dblclick();
  await expect(routine()).toBeVisible();
  await expect(routine().locator('.view-lines')).toContainText('fn_doble');
});

test.afterAll(async () => {
  const pid = app?.process().pid;
  // La rutina queda con cambios sin guardar y la app pregunta al cerrar: se termina el árbol de procesos.
  await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
  if (pid === undefined) return;
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Ya cerró.
    }
  }
});

test('autocompleta con el catálogo dentro del cuerpo de la función', async () => {
  const head =
    'CREATE OR REPLACE FUNCTION dbx.fn_doble(p integer) RETURNS integer LANGUAGE sql AS $$ SELECT c.';
  const tail = ' FROM dbx.clientes c $$';
  await setText(head + tail);
  await page.keyboard.press('End');
  for (let i = 0; i < tail.length; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Control+Space');
  await expect(suggest()).toBeVisible();
  await expect(suggest()).toContainText('nombre');
  await expect(suggest()).toContainText('id');
  await page.keyboard.press('Escape');
});

test('un error de sintaxis se marca en el texto y en Mensajes', async () => {
  await setText(
    'CREATE OR REPLACE FUNCTION dbx.fn_doble(p integer RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$',
  );
  await page.keyboard.press('Control+S');
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByTestId('messages')).toContainText(/syntax error|sintaxis/i);
  await expect(routine().locator('.squiggly-error').first()).toBeVisible();
});
