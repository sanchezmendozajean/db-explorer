import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, tempUserData } from './helpers';

/**
 * Vista Archivos: selección múltiple (Ctrl/Shift), filtro sobre carpetas aún sin abrir y la cabecera
 * `-- @connection: Nombre` (specs/07). El espacio se prepara en disco antes de arrancar la app.
 */

const userData = tempUserData();
const workspace = join(userData, 'Documents', 'DB Explorer');
let app: ElectronApplication;
let page: Page;

test.describe.configure({ mode: 'serial' });

const view = (): ReturnType<Page['locator']> => page.locator('[data-view="files"]');
const tree = (): ReturnType<Page['locator']> => view().locator('.tree');
const row = (name: string): ReturnType<Page['locator']> =>
  tree().getByRole('treeitem', { name, exact: true });

test.beforeAll(async () => {
  mkdirSync(join(workspace, 'profunda', 'nivel2'), { recursive: true });
  for (const name of ['uno.sql', 'dos.sql', 'tres.sql', 'cuatro.sql']) {
    writeFileSync(join(workspace, name), `select '${name}';\n`);
  }
  writeFileSync(join(workspace, 'profunda', 'nivel2', 'escondido.sql'), 'select 1;\n');
  writeFileSync(join(workspace, 'con-cabecera.sql'), '-- @connection: Mi SQLite\nselect 1;\n');
  writeFileSync(join(workspace, 'sin-cabecera.sql'), 'select 2;\n');
  // Conexión y ajuste preparados: el programa los lee al arrancar.
  writeFileSync(
    join(userData, 'connections.json'),
    JSON.stringify({
      version: 1,
      folders: [],
      connections: [
        {
          id: 'lt-1',
          name: 'Mi SQLite',
          engine: 'sqlite',
          environment: 'local',
          file: join(userData, 'e2e.db'),
          sqliteCreate: true,
          savePassword: false,
          readOnly: false,
          confirmWrites: false,
          connectTimeoutSec: 15,
          queryTimeoutSec: 0,
          showSystemObjects: false,
        },
      ],
    }),
  );
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ 'files.connectionHeader': true }));
  app = await launchApp(userData);
  page = await app.firstWindow();
  await page.getByTestId('statusbar').waitFor();
  await page.keyboard.press('Control+Shift+E');
  await expect(row('uno.sql')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
});

test('Ctrl+clic suma y quita archivos de la selección', async () => {
  await row('uno.sql').click();
  await row('tres.sql').click({ modifiers: ['Control'] });
  await expect(row('uno.sql')).toHaveAttribute('aria-selected', 'true');
  await expect(row('tres.sql')).toHaveAttribute('aria-selected', 'true');
  await expect(row('dos.sql')).toHaveAttribute('aria-selected', 'false');
  await row('uno.sql').click({ modifiers: ['Control'] });
  await expect(row('uno.sql')).toHaveAttribute('aria-selected', 'false');
  await expect(row('tres.sql')).toHaveAttribute('aria-selected', 'true');
});

test('Shift+clic y Shift+flecha seleccionan un rango', async () => {
  // Orden del árbol: con-cabecera, cuatro, dos, sin-cabecera, tres, uno.
  await row('cuatro.sql').click();
  await row('tres.sql').click({ modifiers: ['Shift'] });
  for (const name of ['cuatro.sql', 'dos.sql', 'sin-cabecera.sql', 'tres.sql']) {
    await expect(row(name)).toHaveAttribute('aria-selected', 'true');
  }
  await expect(row('con-cabecera.sql')).toHaveAttribute('aria-selected', 'false');
  await expect(row('uno.sql')).toHaveAttribute('aria-selected', 'false');
  // Shift+↓ extiende desde el ancla.
  await tree().focus();
  await page.keyboard.press('Shift+ArrowDown');
  await expect(row('uno.sql')).toHaveAttribute('aria-selected', 'true');
});

test('Supr elimina todos los seleccionados tras una sola confirmación', async () => {
  await row('uno.sql').click();
  await row('dos.sql').click({ modifiers: ['Control'] });
  await tree().focus();
  await page.keyboard.press('Delete');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('2');
  await expect(dialog).toContainText('uno.sql');
  await expect(dialog).toContainText('dos.sql');
  await dialog.getByRole('button', { name: 'Enviar a la Papelera' }).click();
  await expect(row('uno.sql')).toHaveCount(0);
  await expect(row('dos.sql')).toHaveCount(0);
  expect(existsSync(join(workspace, 'uno.sql'))).toBe(false);
  expect(existsSync(join(workspace, 'dos.sql'))).toBe(false);
  expect(existsSync(join(workspace, 'tres.sql'))).toBe(true);
});

test('el filtro encuentra archivos en carpetas que nunca se abrieron', async () => {
  // "escondido.sql" está dos niveles dentro de una carpeta sin abrir.
  await expect(row('escondido.sql')).toHaveCount(0);
  await row('cuatro.sql').click();
  await page.keyboard.type('escond');
  await expect(row('escondido.sql')).toBeVisible();
  await expect(row('profunda')).toBeVisible();
  await expect(row('tres.sql')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(row('tres.sql')).toBeVisible();
});

test('la cabecera -- @connection: elige la conexión al abrir el script', async () => {
  await row('con-cabecera.sql').dblclick();
  const tab = page.getByTestId('editor-tab').filter({ hasText: 'con-cabecera' });
  await expect(tab).toBeVisible();
  await expect(page.getByTestId('editor-toolbar')).toContainText('Mi SQLite');
  // Sin cabecera, el script queda sin conexión.
  await row('sin-cabecera.sql').dblclick();
  await expect(page.getByTestId('editor-tab').filter({ hasText: 'sin-cabecera' })).toBeVisible();
  await expect(page.getByTestId('editor-toolbar')).not.toContainText('Mi SQLite');
});
