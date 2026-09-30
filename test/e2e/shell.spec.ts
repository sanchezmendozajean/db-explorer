import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchApp, tempUserData } from './helpers';

let app: ElectronApplication;
let page: Page;
const userData = tempUserData();

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  app = await launchApp(userData);
  page = await app.firstWindow();
  await page.getByTestId('statusbar').waitFor();
});

test.afterAll(async () => {
  await app?.close();
});

test('muestra title bar, activity bar, barra lateral, pestañas y status bar de Producción', async () => {
  await expect(page.getByRole('menuitem', { name: 'Archivo' })).toBeVisible();
  await expect(page.getByTestId('side-bar')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Script-2/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('statusbar')).toHaveClass(/is-prod/);
  await expect(page.getByTestId('statusbar')).toContainText('PayBox Prod');
  expect(await page.title()).toBe('DB Explorer — DB Explorer');
});

test('Ctrl+B oculta y muestra la barra lateral', async () => {
  await page.keyboard.press('Control+B');
  await expect(page.getByTestId('side-bar')).toHaveCount(0);
  await page.keyboard.press('Control+B');
  await expect(page.getByTestId('side-bar')).toBeVisible();
});

test('Ctrl+J oculta y muestra el panel de resultados', async () => {
  const panel = page.locator('section.panel');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Control+J');
  await expect(panel).toHaveCount(0);
  await page.keyboard.press('Control+J');
  await expect(panel).toBeVisible();
});

test('la paleta de comandos cambia el tema', async () => {
  await page.keyboard.press('Control+Shift+P');
  const input = page.getByTestId('quick-input');
  await expect(input).toHaveValue('>');
  await input.fill('>tema: claro');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(input).toHaveCount(0);

  await page.getByRole('menuitem', { name: 'Ver' }).click();
  await page.getByRole('menuitem', { name: 'Tema' }).click();
  await page.getByRole('menuitem', { name: 'Oscuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('Ctrl+P busca objetos y archivos', async () => {
  await page.keyboard.press('Control+P');
  await page.getByTestId('quick-input').fill('rendic');
  const options = page.locator('.quick-input-item');
  await expect(options.filter({ hasText: 'CRendiciones_Conf_Generales' })).toHaveCount(1);
  await expect(page.getByRole('option', { name: /rendiciones_pendientes\.sql/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('quick-input')).toHaveCount(0);
});

test('cerrar todas las pestañas muestra la marca de agua y Ctrl+Shift+T reabre', async () => {
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+W');
  await expect(page.getByTestId('watermark')).toBeVisible();
  await expect(page.getByTestId('watermark')).toContainText('Ctrl+Shift+P');
  await page.keyboard.press('Control+Shift+T');
  await expect(page.getByTestId('watermark')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+T');
  await page.keyboard.press('Control+Shift+T');
  await expect(page.getByRole('tab', { name: /Script-1/ })).toBeVisible();
  await page.keyboard.press('Alt+1');
  await expect(page.getByRole('tab', { name: /Script-/ }).first()).toHaveAttribute('aria-selected', 'true');
});

test('los tamaños de paneles y el tema se recuerdan al reiniciar', async () => {
  const sidebar = page.getByTestId('side-bar');
  const before = (await sidebar.boundingBox())!.width;
  const sash = page.locator('.sash-vertical');
  const box = (await sash.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await expect(sash).toHaveAttribute('data-separator', 'hover');
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 200, { steps: 8 });
  await page.mouse.up();
  const resized = (await sidebar.boundingBox())!.width;
  expect(resized).toBeGreaterThan(before + 80);

  await page.keyboard.press('Control+Shift+P');
  await page.getByTestId('quick-input').fill('>tema: claro');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600); // guardado diferido de ui-state.json

  await app.close();
  app = await launchApp(userData);
  page = await app.firstWindow();
  await page.getByTestId('statusbar').waitFor();

  const after = (await page.getByTestId('side-bar').boundingBox())!.width;
  expect(Math.abs(after - resized)).toBeLessThanOrEqual(3);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('el menú contextual del árbol se navega con teclado y Esc lo cierra', async () => {
  await page.getByRole('treeitem', { name: /Usuarios/ }).click({ button: 'right' });
  const menu = page.locator('.menu');
  await expect(menu).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.locator('.menu-item.is-active')).toHaveText('Ver datos');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('los menús de la title bar se abren y muestran atajos', async () => {
  await page.locator('.menubar').getByRole('menuitem', { name: 'Ver', exact: true }).click();
  const item = page.locator('.menu-item', { hasText: 'Mostrar/ocultar barra lateral' });
  await expect(item.locator('.menu-keybinding')).toHaveText('Ctrl+B');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.menu')).toContainText('Ejecutar sentencia');
  await page.keyboard.press('Escape');
  await expect(page.locator('.menu')).toHaveCount(0);
});
