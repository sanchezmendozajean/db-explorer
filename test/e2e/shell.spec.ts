import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, tempUserData } from './helpers';

let app: ElectronApplication;
let page: Page;
const userData = tempUserData();

function sideBarWidthSetting(): number | undefined {
  const file = join(userData, 'settings.json');
  if (!existsSync(file)) return undefined;
  return (JSON.parse(readFileSync(file, 'utf8')) as Record<string, number>)['workbench.sideBar.width'];
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  app = await launchApp(userData);
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('Error en el renderer:', e.message));
  await page.getByTestId('statusbar').waitFor();
});

test.afterAll(async () => {
  await app?.close();
});

test('muestra title bar, activity bar, barra lateral, marca de agua y status bar', async () => {
  await expect(page.getByRole('menuitem', { name: 'Archivo' })).toBeVisible();
  await expect(page.getByTestId('side-bar')).toBeVisible();
  // Sin pestañas: marca de agua con atajos (specs/04 §16).
  await expect(page.locator('.editor-content')).toContainText('Nuevo script');
  await expect(page.getByTestId('statusbar')).not.toHaveClass(/is-prod/);
  expect(await page.title()).toBe('DB Explorer — DB Explorer');
  // Ctrl+N crea un script (sin conexión) y abre el panel de resultados.
  await page.keyboard.press('Control+N');
  await expect(page.getByRole('tab', { name: /Script-1/ })).toHaveAttribute('aria-selected', 'true');
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

test('Ctrl+P busca archivos del espacio de trabajo', async () => {
  await page.keyboard.press('Control+P');
  await page.getByTestId('quick-input').fill('scr1');
  await expect(page.getByRole('option', { name: /Script-1.sql/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('quick-input')).toHaveCount(0);
});

test('cerrar todas las pestañas muestra la marca de agua y Ctrl+Shift+T reabre', async () => {
  // Con contenido, el script no se elimina al cerrar su pestaña.
  await page.getByTestId('sql-editor').locator('.view-lines').click();
  await page.keyboard.type('select 1;');
  await page.keyboard.press('Control+W');
  await expect(page.getByTestId('watermark')).toBeVisible();
  await expect(page.getByTestId('watermark')).toContainText('Ctrl+Shift+P');
  await page.keyboard.press('Control+Shift+T');
  await expect(page.getByRole('tab', { name: /Script-1/ })).toBeVisible();
  await page.keyboard.press('Alt+1');
  await expect(page.getByRole('tab', { name: /Script-1/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('sql-editor')).toContainText('select 1;');
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
  // Al soltar, el ancho queda en settings.json.
  await expect.poll(sideBarWidthSetting).toBeGreaterThan(before + 80);
  expect(Math.abs(sideBarWidthSetting()! - resized)).toBeLessThanOrEqual(2);

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

test('el menú contextual se navega con teclado y Esc lo cierra', async () => {
  await page.locator('.editor-tab', { hasText: 'Script-1' }).click({ button: 'right' });
  const menu = page.locator('.menu');
  await expect(menu).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.locator('.menu-item.is-active')).toHaveText(/^Cerrar/);
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
