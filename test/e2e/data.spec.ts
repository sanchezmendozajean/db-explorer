import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, tempUserData } from './helpers';

/**
 * M7 en SQLite: pestaña de objeto (Datos, Estructura, DDL), edición en grilla
 * con guardado, tabla sin clave de solo lectura, exportar a CSV y modo de
 * transacción manual con Rollback/Commit.
 */

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
const dir = tempUserData();

const tree = (): ReturnType<Page['locator']> => page.locator('[data-view="connections"] .tree');
const node = (name: RegExp): ReturnType<Page['locator']> => tree().getByRole('treeitem', { name });
const editor = (): ReturnType<Page['locator']> => page.getByTestId('sql-editor');
const grid = (): ReturnType<Page['locator']> => page.getByTestId('results-grid');

async function typeInEditor(text: string): Promise<void> {
  await editor().locator('.view-lines').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
}

/** Centro de una celda de la grilla (canvas): cabecera de 26 px, filas de 24 px y números de fila de 48 px. */
async function cell(col: number, row: number): Promise<{ x: number; y: number }> {
  const box = (await grid().boundingBox())!;
  const widths = (await grid().getAttribute('data-column-widths'))!.split(',').map(Number);
  const x = box.x + 48 + widths.slice(0, col).reduce((a, b) => a + b, 0) + widths[col]! / 2;
  return { x, y: box.y + 26 + row * 24 + 12 };
}

async function editCell(col: number, row: number, text: string): Promise<void> {
  const p = await cell(col, row);
  const input = page.locator('.gdg-growing-entry textarea, textarea.gdg-input');
  // Cada edición registrada agrega un paso de deshacer.
  const depth = Number(await grid().getAttribute('data-undo-depth'));
  for (let attempt = 0; attempt < 3; attempt++) {
    // Doble clic abre el editor de celda de Glide.
    await page.mouse.dblclick(p.x, p.y);
    await input.waitFor();
    // El editor de Glide es controlado y pierde teclas simuladas: se llena de una vez.
    await input.fill(text);
    await expect(input).toHaveValue(text);
    await page.waitForTimeout(50);
    await page.keyboard.press('Enter');
    await expect(input).toHaveCount(0);
    // Glide guarda el texto del editor en un cuadro posterior: con la máquina cargada, Enter a veces
    // confirma el valor anterior (a velocidad humana no pasa). Si la edición no se registró, se repite.
    const registered = await expect(grid())
      .toHaveAttribute('data-undo-depth', String(depth + 1), { timeout: 1000 })
      .then(() => true)
      .catch(() => false);
    if (registered) return;
  }
  throw new Error(`La edición de la celda (${col}, ${row}) no se registró`);
}

/** Copia la tabla cargada (menú Exportar) y devuelve el TSV del portapapeles. */
async function copiedTable(): Promise<string> {
  await page.getByTestId('export-menu').click();
  await page.getByRole('menuitem', { name: 'Copiar tabla (con cabeceras)' }).click();
  return app.evaluate(async ({ clipboard }) => clipboard.readText());
}

async function runScript(sql: string): Promise<void> {
  await typeInEditor(sql);
  await page.keyboard.press('Alt+X');
  await expect(page.getByTestId('execution-timer')).toHaveCount(0, { timeout: 20_000 });
}

test.beforeAll(async () => {
  app = await launchApp(tempUserData());
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('Error en el renderer:', e.message));
  await page.getByTestId('statusbar').waitFor();
});

test.afterAll(async () => {
  const pid = app?.process().pid;
  // Si una prueba deja cambios sin guardar, la app pregunta antes de cerrar: se termina el árbol de procesos.
  await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
  if (pid === undefined) return;
  // En Windows `kill` no alcanza: la app quedaba viva y cargaba la máquina en las pruebas siguientes.
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

test('prepara una base SQLite con una tabla con clave y otra sin clave', async () => {
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Nueva conexión' }).first().click();
  await dialog.getByRole('button', { name: 'SQLite' }).click();
  await dialog.getByLabel('Nombre', { exact: true }).fill('Datos');
  await dialog.getByLabel('Ruta del archivo').fill(join(dir, 'datos.db'));
  await dialog.getByLabel('Crear si no existe').check();
  await dialog.getByRole('button', { name: 'Guardar' }).click();
  await node(/^LT Datos/).click();
  await page.keyboard.press('Control+N');
  await runScript(
    'create table clientes (id integer primary key, nombre text not null, importe decimal(12,2));\n' +
      "insert into clientes (nombre, importe) values ('Ana', '10.50'), ('Beto', '0.00'), ('Carla', null);\n" +
      "create table sin_clave (a text, b text);\ninsert into sin_clave values ('x', 'y');",
  );
  await expect(page.getByTestId('messages')).not.toContainText('Error');
});

test('doble clic en una tabla abre la pestaña de objeto con sus datos editables', async () => {
  await node(/^LT Datos/).click();
  await page.keyboard.press('F5');
  await node(/^LT Datos/)
    .locator('.tree-twistie')
    .click();
  await node(/^Tablas/)
    .locator('.tree-twistie')
    .click();
  await node(/^clientes/).dblclick();
  await expect(page.getByTestId('object-view')).toBeVisible();
  await expect(grid()).toHaveAttribute('data-columns', 'id,nombre,importe');
  await expect(page.getByTestId('results-footer')).toContainText('3 filas');
  await expect(grid()).toHaveAttribute('data-editable', 'true');
});

test('edita una celda, agrega y elimina filas, y guarda con "Ver SQL"', async () => {
  await editCell(1, 0, 'Ana María');
  await expect(page.getByTestId('save-changes')).toHaveText('Guardar (1)');

  await page.keyboard.press('Alt+Insert');
  await editCell(1, 3, 'Nuevo');
  await editCell(2, 3, '7.25');

  // Fila "Beto": clic en su número de fila y Ctrl+Supr.
  const beto = await cell(0, 1);
  const box = (await grid().boundingBox())!;
  await page.mouse.click(box.x + 20, beto.y);
  await page.keyboard.press('Control+Delete');
  await expect(page.getByTestId('pending-changes')).toHaveText('3 cambios pendientes');

  await page.getByRole('button', { name: 'Ver SQL' }).click();
  const preview = page.getByTestId('sql-preview');
  await expect(preview).toContainText('DELETE FROM clientes WHERE id = 2;');
  await expect(preview).toContainText("UPDATE clientes SET nombre = 'Ana María' WHERE id = 1;");
  await expect(preview).toContainText("INSERT INTO clientes (nombre, importe) VALUES ('Nuevo', 7.25);");
  await page.getByRole('dialog').getByRole('button', { name: 'Aplicar' }).click();

  await expect(page.getByTestId('pending-changes')).toHaveCount(0);
  await expect(page.getByTestId('results-footer')).toContainText('3 filas');
  const tsv = await copiedTable();
  expect(tsv.trim().split(/\r?\n/)).toEqual([
    'id\tnombre\timporte',
    '1\tAna María\t10.5',
    '3\tCarla\t',
    '4\tNuevo\t7.25',
  ]);
});

test('Ctrl+Z deshace un cambio pendiente', async () => {
  await editCell(1, 1, 'Carlota');
  await expect(page.getByTestId('save-changes')).toBeVisible();
  const p = await cell(1, 1);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Control+Z');
  await expect(page.getByTestId('save-changes')).toHaveCount(0);
});

test('la pestaña Estructura y el DDL muestran la tabla', async () => {
  await page.getByRole('tab', { name: 'Estructura' }).click();
  const structure = page.getByTestId('structure');
  await expect(structure).toContainText('nombre');
  await expect(structure).toContainText('Clave primaria');
  await page.getByRole('tab', { name: 'DDL' }).click();
  await expect(page.getByTestId('ddl-editor')).toHaveAttribute('data-ddl', /CREATE TABLE clientes/);
  await page.getByRole('tab', { name: 'Datos' }).click();
});

test('el WHERE filtra los datos de la pestaña de objeto', async () => {
  await page.getByTestId('clause-where').locator('.view-lines').click();
  await page.keyboard.type("nombre like 'C%'");
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('results-footer')).toContainText('1 fila');
});

test('exporta los datos a CSV', async () => {
  const path = join(dir, 'clientes.csv');
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: file,
    })) as typeof dialog.showSaveDialog;
  }, path);
  await page.getByTestId('export-menu').click();
  await page.getByRole('menuitem', { name: 'CSV' }).click();
  await page.getByRole('dialog').getByLabel('Separador').selectOption(';');
  await page.getByRole('button', { name: 'Exportar…' }).click();
  await expect(page.getByText(/Se exportó 1 fila/)).toBeVisible({ timeout: 10_000 });
  expect(readFileSync(path, 'utf8')).toBe('id;nombre;importe\r\n3;Carla;\r\n');
});

test('una tabla sin clave queda de solo lectura con la explicación', async () => {
  await node(/^sin_clave/).dblclick();
  await expect(grid()).toHaveAttribute('data-columns', 'a,b');
  await expect(grid()).toHaveAttribute('data-editable', 'false');
  await expect(page.getByTestId('read-only')).toHaveAttribute('title', /no tiene clave primaria/);
});

test('modo manual: Rollback descarta y Commit confirma', async () => {
  // Pestaña del script (la primera).
  await page.getByRole('tab', { name: /^Script-/ }).click();
  await page.getByTestId('transaction-chip').click();
  await page.getByRole('menuitem', { name: 'Manual' }).click();
  await expect(page.getByTestId('transaction-status')).toHaveText('Manual (0)');

  await runScript("insert into clientes (nombre) values ('tx');");
  await expect(page.getByTestId('tx-pending')).toHaveText('1 sentencia pendiente');
  await page.getByRole('button', { name: 'Rollback (Ctrl+Alt+R)' }).click();
  await expect(page.getByTestId('tx-pending')).toHaveCount(0);

  await runScript("insert into clientes (nombre) values ('confirmado');");
  await expect(page.getByTestId('tx-pending')).toHaveText('1 sentencia pendiente');
  await page.keyboard.press('Control+Alt+C');
  await expect(page.getByTestId('transaction-status')).toHaveText('Manual (0)');
  await runScript("select nombre from clientes where nombre in ('tx', 'confirmado')");
  await expect(grid()).toHaveAttribute('data-columns', 'nombre');
  const tsv = await copiedTable();
  expect(tsv.trim().split(/\r?\n/)).toEqual(['nombre', 'confirmado']);
});

test('formato de columna con vista previa y copiar como JSON', async () => {
  await runScript('select 1234.5678 as monto');
  await expect(grid()).toHaveAttribute('data-columns', 'monto');
  const p = await cell(0, 0);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Formato de columna…' }).click();
  const popover = page.getByRole('dialog', { name: 'Formato de monto' });
  await popover.getByLabel('Dígitos significativos').fill('3');
  await expect(page.getByTestId('format-preview')).toContainText('1,230');
  await popover.getByRole('button', { name: 'Aplicar' }).click();
  await expect(popover).toHaveCount(0);

  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Copiar como' }).hover();
  await page.getByRole('menuitem', { name: 'JSON' }).click();
  const text = await app.evaluate(async ({ clipboard }) => clipboard.readText());
  // Se copia el valor crudo, no el formateado.
  expect(JSON.parse(text)).toEqual([{ monto: 1234.5678 }]);
});
