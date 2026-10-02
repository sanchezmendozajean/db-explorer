import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, pgConfig, tempUserData } from './helpers';

/**
 * Productividad del editor (M6, specs/05): autocompletado con alias y
 * entrecomillado, hover, F12, formateo, historial y keybindings.json.
 */

const pg = pgConfig();
const userData = tempUserData();
const SHOTS = process.env['DBX_SHOTS'];
let app: ElectronApplication;
let page: Page;

test.describe.configure({ mode: 'serial' });

const editor = (): ReturnType<Page['locator']> => page.getByTestId('sql-editor');
const suggest = (): ReturnType<Page['locator']> => editor().locator('.suggest-widget');

async function typeInEditor(text: string): Promise<void> {
  await editor().locator('.view-lines').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
  // Se cierra cualquier sugerencia abierta mientras se escribía.
  await page.keyboard.press('Escape');
}

/** Lleva el cursor justo después de la primera aparición de `marker` en la primera línea. */
async function cursorAfter(text: string, marker: string): Promise<void> {
  await page.keyboard.press('Control+Home');
  const column = text.indexOf(marker) + marker.length;
  for (let i = 0; i < column; i++) await page.keyboard.press('ArrowRight');
}

test.beforeAll(async () => {
  app = await launchApp(userData);
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('Error en el renderer:', e.message));
  await page.getByTestId('statusbar').waitFor();
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Nueva conexión' }).first().click();
  await dialog.getByRole('button', { name: 'PostgreSQL' }).click();
  await dialog.getByLabel('Nombre', { exact: true }).fill('PG Local');
  await dialog.getByLabel('Host').fill(pg.host);
  await dialog.getByLabel('Puerto').fill(String(pg.port));
  await dialog.getByLabel('Base de datos (opcional)').fill(pg.database);
  await dialog.getByLabel('Usuario').fill(pg.user);
  await dialog.getByLabel('Contraseña', { exact: true }).fill(pg.password);
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await page
    .locator('[data-view="connections"] .tree')
    .getByRole('treeitem', { name: /PG Local/ })
    .click();
  await page.keyboard.press('Control+N');
  // Ejecutar conecta la pestaña (y deja la consulta en el historial).
  await typeInEditor('select 1 as uno');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('results-grid')).toHaveAttribute('data-columns', 'uno');
});

test.afterAll(async () => {
  await app?.close();
});

test('SELECT c. FROM clientes c sugiere las columnas de clientes', async () => {
  const sql = 'SELECT c. FROM clientes c';
  await typeInEditor(sql);
  await cursorAfter(sql, 'c.');
  await page.keyboard.press('Control+Space');
  await expect(suggest()).toBeVisible();
  await expect(suggest()).toContainText('nombre');
  await expect(suggest()).toContainText('id');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'm6-autocompletado.png') });
  await page.keyboard.press('Escape');
});

test('un nombre con mayúsculas en Postgres se inserta entre comillas', async () => {
  await typeInEditor('select * from CRen');
  await page.keyboard.press('End');
  await page.keyboard.press('Control+Space');
  await expect(suggest()).toContainText('CRendiciones_Conf_Generales');
  await page.keyboard.press('Enter');
  await expect(editor().locator('.view-lines')).toContainText('select * from "CRendiciones_Conf_Generales"');
});

test('hover sobre una tabla muestra sus columnas con tipos', async () => {
  await typeInEditor('select * from clientes');
  const word = editor().locator('.view-line span', { hasText: 'clientes' }).last();
  await word.hover();
  const hover = page.locator('.monaco-hover').filter({ hasText: 'dbx.clientes' });
  await expect(hover).toBeVisible({ timeout: 5000 });
  await expect(hover).toContainText('nombre');
});

test('F12 abre la pestaña de objeto de la tabla bajo el cursor', async () => {
  const sql = 'select * from clientes';
  await typeInEditor(sql);
  await cursorAfter(sql, 'client');
  await page.keyboard.press('F12');
  await expect(page.getByTestId('object-view')).toBeVisible();
  await expect(page.getByRole('tab', { name: /^clientes/ })).toBeVisible();
  await page.keyboard.press('Control+W');
  await expect(page.getByTestId('object-view')).toHaveCount(0);
});

test('Shift+Alt+F formatea el script con el dialecto de la conexión', async () => {
  await typeInEditor('select a,b from t;');
  await page.keyboard.press('Shift+Alt+F');
  await expect(editor().locator('.view-line')).toHaveCount(5);
  await expect(editor().locator('.view-lines')).toContainText('select');
  await expect(editor().locator('.view-lines')).toContainText('from');
});

test('el historial lista lo ejecutado y doble clic lo abre en un script nuevo', async () => {
  await page.getByRole('tab', { name: 'Historial' }).click();
  const history = page.locator('[data-view="history"] .tree');
  const entry = history.getByRole('treeitem').filter({ hasText: 'select 1 as uno' }).first();
  await expect(entry).toBeVisible();
  await expect(entry).toContainText('PG Local');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'm6-historial.png') });
  await entry.dblclick();
  await expect(page.getByTestId('editor-tab').filter({ hasText: 'Script-2' })).toBeVisible();
  await expect(editor().locator('.view-lines')).toContainText('select 1 as uno');
});

test('reasignar Ctrl+Enter en keybindings.json surte efecto sin reiniciar', async () => {
  await page.keyboard.press('Control+Shift+P');
  await page.keyboard.type('keybindings.json');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('editor-tab').filter({ hasText: 'keybindings.json' })).toBeVisible();
  // Se guarda como lo haría otro editor: la app recarga el archivo y aplica los atajos.
  writeFileSync(
    join(userData, 'keybindings.json'),
    JSON.stringify([
      { key: 'ctrl+e', command: 'db.executeStatement', when: 'editorTextFocus' },
      { key: 'ctrl+enter', command: '-db.executeStatement' },
    ]),
  );
  await page.getByTestId('editor-tab').filter({ hasText: 'Script-2' }).click();
  await typeInEditor('select 5 as cinco');
  // El archivo se recarga al detectar el cambio: se reintenta el atajo hasta que se aplica.
  await expect(async () => {
    await page.keyboard.press('Control+E');
    await expect(page.getByTestId('results-grid')).toHaveAttribute('data-columns', 'cinco', { timeout: 500 });
  }).toPass({ timeout: 8000 });
  // Ctrl+Enter quedó sin comando: ya no ejecuta.
  await typeInEditor('select 6 as seis');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(500);
  await expect(page.getByTestId('results-grid')).toHaveAttribute('data-columns', 'cinco');
});

test('settings.json se abre con autocompletado de claves', async () => {
  await page.keyboard.press('Control+Shift+P');
  await page.keyboard.type('settings.json');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('editor-tab').filter({ hasText: 'settings.json' })).toBeVisible();
  // Dentro de las llaves de la plantilla (penúltima línea: "{").
  await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('"files.');
  await page.keyboard.press('Control+Space');
  await expect(suggest()).toContainText('files.autoSave');
  await page.keyboard.press('Escape');
});
