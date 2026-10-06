import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { join } from 'node:path';
import { launchApp, tempUserData } from './helpers';

/**
 * M9, accesibilidad básica: F6 / Shift+F6 recorren las partes del workbench
 * y el elemento enfocado con teclado siempre muestra el foco.
 */

test.describe.configure({ mode: 'serial' });

const userData = tempUserData();
let app: ElectronApplication;
let page: Page;

/** Parte del workbench que tiene el foco (la más específica). */
function focusedPart(): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return 'ninguna';
    if (el.closest('[data-focus-context~="resultsFocus"]')) return 'resultados';
    if (el.closest('.editor-group')) return 'editor';
    if (el.closest('.sidebar')) return 'barra lateral';
    if (el.closest('.activitybar')) return 'barra de actividad';
    if (el.closest('.statusbar')) return 'barra de estado';
    return 'otra';
  });
}

/** El elemento enfocado se distingue: contorno, borde de foco o fila seleccionada con contorno. */
function focusIsVisible(): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const visible = (node: Element): boolean => {
      const style = getComputedStyle(node);
      return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
    };
    // Monaco dibuja su propio cursor; la grilla y los árboles marcan la fila o celda activa.
    if (el.closest('.monaco-editor')) return true;
    const row = el.querySelector('.tree-row.is-selected');
    return visible(el) || (row !== null && visible(row));
  });
}

test.beforeAll(async () => {
  app = await launchApp(userData);
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('Error en el renderer:', e.message));
  await page.getByTestId('statusbar').waitFor();
  // Una conexión SQLite y un script, para que haya árbol, editor y panel de resultados.
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Nueva conexión' }).first().click();
  await dialog.getByRole('button', { name: 'SQLite' }).click();
  await dialog.getByLabel('Nombre', { exact: true }).fill('Teclado');
  await dialog.getByLabel('Ruta del archivo').fill(join(userData, 'teclado.db'));
  await dialog.getByLabel('Crear si no existe').check();
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await page
    .locator('[data-view="connections"] .tree')
    .getByRole('treeitem', { name: /Teclado/ })
    .click();
  await page.keyboard.press('Control+N');
  await page.getByTestId('sql-editor').locator('.view-lines').click();
  await page.keyboard.type('select 1 as uno');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('results-grid')).toHaveAttribute('data-columns', 'uno');
});

test.afterAll(async () => {
  await app?.close();
});

test('F6 recorre las cinco partes y Shift+F6 vuelve', async () => {
  await page.keyboard.press('Control+1');
  expect(await focusedPart()).toBe('editor');
  const visited: string[] = [];
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('F6');
    visited.push(await focusedPart());
    expect(await focusIsVisible(), `foco visible en ${visited.at(-1)}`).toBe(true);
  }
  expect(visited).toEqual(['resultados', 'barra de estado', 'barra de actividad', 'barra lateral', 'editor']);
  await page.keyboard.press('Shift+F6');
  expect(await focusedPart()).toBe('barra lateral');
  await page.keyboard.press('Shift+F6');
  expect(await focusedPart()).toBe('barra de actividad');
});

test('el árbol de conexiones se maneja con el teclado', async () => {
  await page.keyboard.press('F6');
  expect(await focusedPart()).toBe('barra lateral');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  // Expandir conecta y muestra la carpeta Tablas debajo.
  await expect(
    page.locator('[data-view="connections"] .tree').getByRole('treeitem', { name: /^Tablas/ }),
  ).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-view="connections"] .tree-row.is-selected')).toContainText('Tablas');
  expect(await focusIsVisible()).toBe(true);
});

test('las pestañas de resultados se cambian con las flechas', async () => {
  await page.keyboard.press('Control+2');
  // Ctrl+2 enfoca el panel en el cuadro siguiente: se espera antes de elegir la pestaña.
  await expect(page.locator('[data-focus-context~="resultsFocus"]')).toBeFocused();
  await page.getByRole('tab', { name: /Resultado 1/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Mensajes' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Mensajes' })).toHaveAttribute('aria-selected', 'true');
  expect(await focusIsVisible()).toBe(true);
});
