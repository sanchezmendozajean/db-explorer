import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, tempUserData } from './helpers';

/**
 * M9: Preferencias con UI (specs/04 §15): grupos, buscador, Formatos de datos
 * con vista previa en vivo y Restablecer, formato propio de una conexión
 * (specs/06 nivel 2) y tema.
 */

test.describe.configure({ mode: 'serial' });

const SHOTS = process.env['DBX_SHOTS'];
const userData = tempUserData();
let app: ElectronApplication;
let page: Page;

const prefs = (): ReturnType<Page['locator']> => page.getByTestId('preferences');
const setting = (id: string): ReturnType<Page['locator']> => prefs().locator(`[data-pref="${id}"]`);
const grid = (): ReturnType<Page['locator']> => page.getByTestId('results-grid');

function settingsJson(): string {
  const file = join(userData, 'settings.json');
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
}

test.beforeAll(async () => {
  app = await launchApp(userData);
  await app.evaluate(({ clipboard }) => clipboard.writeText(''));
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('Error en el renderer:', e.message));
  await page.getByTestId('statusbar').waitFor();
});

test.afterAll(async () => {
  await app?.close();
});

test('muestra los seis grupos y el buscador filtra sin tildes', async () => {
  await page.keyboard.press('Control+,');
  for (const group of ['Editor', 'Archivos', 'Resultados', 'Formatos de datos', 'Conexiones', 'Apariencia']) {
    await expect(prefs().getByRole('heading', { name: group, exact: true })).toBeVisible();
  }
  await prefs().getByRole('textbox', { name: 'Buscar preferencias' }).fill('separador decimal');
  await expect(prefs().getByRole('heading', { level: 2 })).toHaveText(['Formatos de datos']);
  await expect(setting('format-numbers')).toBeVisible();
  await prefs().getByRole('textbox', { name: 'Buscar preferencias' }).fill('tabulacion');
  await expect(setting('editor-tab-size')).toBeVisible();
  await prefs().getByRole('textbox', { name: 'Buscar preferencias' }).press('Escape');
  await expect(prefs().getByRole('heading', { level: 2 })).toHaveCount(6);
});

test('Formatos de datos: la vista previa cambia al momento y Restablecer vuelve al valor por defecto', async () => {
  const decimal = setting('format-decimal');
  await expect(decimal.getByTestId('pref-preview')).toContainText('999,999,999.00');
  await decimal.getByRole('combobox').selectOption({ label: 'Cantidad fija' });
  await decimal.getByLabel('Cantidad de decimales').fill('0');
  await decimal.getByLabel('Cantidad de decimales').press('Enter');
  await expect(decimal.getByTestId('pref-preview').locator('code').first()).toHaveText('999,999,999');
  await expect.poll(settingsJson).toContain('"format.decimal.places": 0');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'm9-preferencias.png') });
  await decimal.getByRole('button', { name: 'Restablecer' }).click();
  await expect.poll(settingsJson).not.toContain('format.decimal');
  await expect(decimal.getByTestId('pref-preview')).toContainText('999,999,999.00');
});

test('una conexión puede tener su propio formato y la grilla lo usa', async () => {
  // Conexión SQLite para elegirla en "Aplicar a".
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Nueva conexión' }).first().click();
  await dialog.getByRole('button', { name: 'SQLite' }).click();
  await dialog.getByLabel('Nombre', { exact: true }).fill('Formatos');
  await dialog.getByLabel('Ruta del archivo').fill(join(userData, 'formatos.db'));
  await dialog.getByLabel('Crear si no existe').check();
  await dialog.getByRole('button', { name: 'Guardar' }).click();

  await page.getByRole('tab', { name: /Preferencias/ }).click();
  await prefs().getByTestId('format-scope').selectOption({ label: 'Formatos' });
  const float = setting('format-float');
  await float.getByLabel('Dígitos significativos').fill('3');
  await float.getByLabel('Dígitos significativos').press('Enter');
  await expect(float).toContainText('Propio de esta conexión');
  await expect(float.getByTestId('pref-preview')).toContainText('3.14');
  await expect.poll(settingsJson).toContain('"format.connections"');
  // Para todas las conexiones sigue el global.
  await prefs().getByTestId('format-scope').selectOption({ label: 'Todas las conexiones' });
  await expect(float.getByTestId('pref-preview')).toContainText('3.14159265358979');

  await page
    .locator('[data-view="connections"] .tree')
    .getByRole('treeitem', { name: /Formatos/ })
    .click();
  await page.keyboard.press('Control+N');
  await page.getByTestId('sql-editor').locator('.view-lines').click();
  await page.keyboard.type('select 3.14159265 as x');
  await page.keyboard.press('Control+Enter');
  await expect(grid()).toHaveAttribute('data-columns', 'x');
  await expect(page.getByTestId('results-footer')).toContainText('1 fila');
  // Copiar como › TSV con formato usa el formato que muestra la grilla.
  const box = (await grid().boundingBox())!;
  await page.mouse.click(box.x + 80, box.y + 38);
  await page.mouse.click(box.x + 80, box.y + 38, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Copiar como' }).hover();
  await page.getByRole('menuitem', { name: 'TSV con formato' }).click();
  // Encabezado y la celda con el formato de la conexión (3 dígitos significativos).
  await expect
    .poll(() => app.evaluate(async ({ clipboard }) => (await clipboard.readText()).trim()))
    .toMatch(/^x\r?\n3\.14$/);
});

test('Apariencia cambia el tema', async () => {
  await page.getByRole('tab', { name: /Preferencias/ }).click();
  await prefs().getByRole('combobox', { name: 'Tema' }).selectOption({ label: 'Claro' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await setting('appearance-theme').getByRole('button', { name: 'Restablecer' }).click();
  await expect(prefs().getByRole('combobox', { name: 'Tema' })).toHaveValue('system');
});
