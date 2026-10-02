import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, tempUserData } from './helpers';

/**
 * Vista Archivos y espacio de trabajo (M5, specs/07 y 11): crear, renombrar,
 * copiar, mover y eliminar desde el árbol; cambios externos; archivos de
 * texto; cambiar de espacio y espacio no disponible; Guardar como y Abrir.
 */

const userData = tempUserData();
const workspace = join(userData, 'Documents', 'DB Explorer');
const SHOTS = process.env['DBX_SHOTS'];
const otherWorkspace = join(tempUserData(), 'Otro espacio');
let app: ElectronApplication;
let page: Page;

test.describe.configure({ mode: 'serial' });

async function start(): Promise<void> {
  app = await launchApp(userData);
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('Error en el renderer:', e.message));
  await page.getByTestId('statusbar').waitFor();
}

const view = (): ReturnType<Page['locator']> => page.locator('[data-view="files"]');
const tree = (): ReturnType<Page['locator']> => view().locator('.tree');
const row = (name: string): ReturnType<Page['locator']> =>
  tree().getByRole('treeitem', { name, exact: true });
const input = (): ReturnType<Page['locator']> => page.getByTestId('files-inline-input');
const settingsJson = (): string => {
  const file = join(userData, 'settings.json');
  return existsSync(file) ? readFileSync(file, 'utf8') : '';
};

/** Botón de la cabecera de la sección (visible al pasar el mouse, como en VS Code). */
async function sectionButton(name: string): Promise<void> {
  await view().locator('.sidebar-section').hover();
  await view().getByRole('button', { name }).click();
}

/** Reemplaza los diálogos nativos de main por respuestas fijas (no se pueden manejar desde Playwright). */
async function stubDialog(kind: 'open' | 'save', path: string): Promise<void> {
  await app.evaluate(
    ({ dialog }, { kind, path }) => {
      if (kind === 'open')
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as never;
      else dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as never;
    },
    { kind, path },
  );
}

test.beforeAll(start);

test.afterAll(async () => {
  await app?.close();
});

test('Ctrl+N crea el script y aparece en la vista Archivos', async () => {
  await page.keyboard.press('Control+N');
  await expect(page.getByTestId('editor-tab').filter({ hasText: 'Script-1' })).toBeVisible();
  await page.keyboard.press('Control+Shift+E');
  await expect(row('Script-1.sql')).toBeVisible();
});

test('crea una carpeta y un archivo con el campo en línea (con .sql sugerido)', async () => {
  await sectionButton('Nueva carpeta');
  await input().fill('consultas');
  await input().press('Enter');
  await expect(row('consultas')).toBeVisible();
  expect(existsSync(join(workspace, 'consultas'))).toBe(true);

  await row('consultas').click();
  await sectionButton('Nuevo archivo');
  await input().fill('ventas');
  await input().press('Enter');
  await expect(row('ventas.sql')).toBeVisible();
  expect(existsSync(join(workspace, 'consultas', 'ventas.sql'))).toBe(true);
  await expect(page.getByTestId('editor-tab').filter({ hasText: 'ventas' })).toBeVisible();

  // Un nombre no válido se avisa en el mismo campo y no se crea.
  await sectionButton('Nuevo archivo');
  await input().fill('a:b');
  await expect(view().getByText(/no puede contener/)).toBeVisible();
  if (SHOTS)
    await page.screenshot({
      path: join(SHOTS, 'm5-nombre-invalido.png'),
      clip: { x: 0, y: 0, width: 700, height: 300 },
    });
  await input().press('Escape');
  await expect(input()).toHaveCount(0);
});

test('F2 renombra el archivo y su pestaña abierta', async () => {
  await row('ventas.sql').click();
  await tree().focus();
  await page.keyboard.press('F2');
  await expect(input()).toHaveValue('ventas.sql');
  await input().fill('reporte.sql');
  await input().press('Enter');
  await expect(row('reporte.sql')).toBeVisible();
  expect(existsSync(join(workspace, 'consultas', 'reporte.sql'))).toBe(true);
  expect(existsSync(join(workspace, 'consultas', 'ventas.sql'))).toBe(false);
  await expect(page.getByTestId('editor-tab').filter({ hasText: 'reporte' })).toBeVisible();
  await expect(page.getByTestId('editor-tab').filter({ hasText: 'ventas' })).toHaveCount(0);
});

test('copiar y pegar agrega " copia" al nombre', async () => {
  await row('reporte.sql').click();
  await tree().focus();
  await page.keyboard.press('Control+C');
  await page.keyboard.press('Control+V');
  await expect(row('reporte copia.sql')).toBeVisible();
  expect(existsSync(join(workspace, 'consultas', 'reporte copia.sql'))).toBe(true);
});

test('mover arrastrando pide confirmación', async () => {
  await row('reporte copia.sql').dragTo(row('Script-1.sql'));
  await page.getByRole('dialog').getByRole('button', { name: 'Mover', exact: true }).click();
  await expect.poll(() => existsSync(join(workspace, 'reporte copia.sql'))).toBe(true);
  expect(existsSync(join(workspace, 'consultas', 'reporte copia.sql'))).toBe(false);
});

test('Supr envía a la papelera con confirmación', async () => {
  await row('reporte copia.sql').click();
  await tree().focus();
  await page.keyboard.press('Delete');
  await page.getByRole('dialog').getByRole('button', { name: 'Enviar a la Papelera' }).click();
  await expect(row('reporte copia.sql')).toHaveCount(0);
  expect(existsSync(join(workspace, 'reporte copia.sql'))).toBe(false);
  // En pruebas la papelera es una carpeta del perfil (no la de Windows).
  expect(readdirSync(join(userData, 'Papelera')).some((n) => n.endsWith('reporte copia.sql'))).toBe(true);
});

test('los cambios hechos fuera de la app se reflejan en el árbol', async () => {
  const file = join(workspace, 'externo.sql');
  writeFileSync(file, 'select 1;');
  await expect(row('externo.sql')).toBeVisible({ timeout: 5000 });
  rmSync(file);
  await expect(row('externo.sql')).toHaveCount(0, { timeout: 5000 });
});

test('un archivo de texto se abre en vista previa con un clic, sin barra de ejecución', async () => {
  writeFileSync(join(workspace, 'notas.md'), '# Notas\n');
  await row('notas.md').click();
  const tab = page.getByTestId('editor-tab').filter({ hasText: 'notas.md' });
  await expect(tab).toBeVisible();
  await expect(tab).toHaveClass(/is-preview/);
  await expect(page.getByTestId('editor-toolbar')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'm5-archivos.png') });
  await row('notas.md').dblclick();
  await expect(tab).not.toHaveClass(/is-preview/);
});

test('Guardar como y Abrir archivo funcionan también fuera del espacio', async () => {
  const outside = tempUserData();
  await page.getByTestId('editor-tab').filter({ hasText: 'Script-1' }).click();
  await stubDialog('save', join(outside, 'copia-fuera.sql'));
  await page.keyboard.press('Control+Shift+S');
  await expect(page.getByTestId('editor-tab').filter({ hasText: 'copia-fuera' })).toBeVisible();
  expect(existsSync(join(outside, 'copia-fuera.sql'))).toBe(true);

  const external = join(outside, 'externo.sql');
  writeFileSync(external, 'select 99 as de_fuera;');
  await stubDialog('open', external);
  await page.keyboard.press('Control+O');
  await expect(page.getByTestId('editor-tab').filter({ hasText: 'externo' })).toBeVisible();
  await expect(page.getByTestId('sql-editor').locator('.view-lines')).toContainText('de_fuera');
});

test('cambiar el espacio de trabajo y reiniciar abre el nuevo con sus pestañas', async () => {
  mkdirSync(otherWorkspace, { recursive: true });
  await stubDialog('open', otherWorkspace);
  await page.getByRole('menuitem', { name: 'Archivo' }).click();
  await page.getByRole('menuitem', { name: 'Cambiar espacio de trabajo…' }).click();
  await expect(view().locator('.sidebar-section-header')).toContainText('Otro espacio');
  await expect(page.getByTestId('editor-tab')).toHaveCount(0);
  await page.keyboard.press('Control+N');
  await expect(page.getByTestId('editor-tab').filter({ hasText: 'Script-1' })).toBeVisible();
  await expect.poll(() => existsSync(join(otherWorkspace, 'Script-1.sql'))).toBe(true);
  expect(settingsJson()).toContain('Otro espacio');

  await app.close();
  await start();
  await page.keyboard.press('Control+Shift+E');
  await expect(view().locator('.sidebar-section-header')).toContainText('Otro espacio');
  await expect(page.getByTestId('editor-tab').filter({ hasText: 'Script-1' })).toBeVisible();
  await expect(page).toHaveTitle('Otro espacio — DB Explorer');
});

test('si el espacio no está al iniciar, "Usar el predeterminado" no olvida la ruta', async () => {
  await app.close();
  rmSync(otherWorkspace, { recursive: true, force: true });
  await start();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('No se encuentra el espacio de trabajo');
  await dialog.getByRole('button', { name: 'Usar el predeterminado' }).click();
  await page.keyboard.press('Control+Shift+E');
  await expect(view().locator('.sidebar-section-header')).toContainText('DB Explorer');
  await expect(row('Script-1.sql')).toBeVisible();
  expect(settingsJson()).toContain('Otro espacio');
});

test('Preferencias › Archivos cambia el guardado automático y su retraso', async () => {
  await page.keyboard.press('Control+,');
  const prefs = page.getByTestId('preferences');
  await expect(prefs).toContainText('Espacio de trabajo');
  await expect(prefs.getByRole('textbox', { name: 'Espacio de trabajo' })).toHaveValue(workspace);
  await prefs.getByLabel('Retraso (segundos)').fill('10');
  await prefs.getByLabel('Retraso (segundos)').press('Enter');
  await expect.poll(settingsJson).toContain('"files.autoSaveDelay": 10000');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'm5-preferencias.png') });
  await prefs.getByLabel('Guardar automáticamente los scripts').uncheck();
  await expect.poll(settingsJson).toContain('"files.autoSave": false');
  await expect(prefs.getByLabel('Retraso (segundos)')).toBeDisabled();
  await expect(page.getByTestId('autosave-toggle')).toContainText('Autoguardado: no');
});
