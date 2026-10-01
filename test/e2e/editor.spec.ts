import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, pgConfig, tempUserData } from './helpers';

const pg = pgConfig();
const userData = tempUserData();
const workspace = join(userData, 'Documents', 'DB Explorer');
const SHOTS = process.env['DBX_SHOTS'];
let app: ElectronApplication;
let page: Page;

test.describe.configure({ mode: 'serial' });

async function start(): Promise<void> {
  app = await launchApp(userData);
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('Error en el renderer:', e.message));
  await page.getByTestId('statusbar').waitFor();
}

const dialog = (): ReturnType<Page['locator']> => page.getByRole('dialog');
const tree = (): ReturnType<Page['locator']> => page.locator('[data-view="connections"] .tree');
const editor = (): ReturnType<Page['locator']> => page.getByTestId('sql-editor');

async function shot(name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** Reemplaza el contenido del editor activo escribiendo como el usuario. */
async function typeInEditor(text: string): Promise<void> {
  await editor().locator('.view-lines').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
}

test.beforeAll(start);

test.afterAll(async () => {
  await app?.close();
});

test('crea una conexión y un script nuevo con Ctrl+N en el espacio de trabajo', async () => {
  await page.getByRole('button', { name: 'Nueva conexión' }).first().click();
  await dialog().getByRole('button', { name: 'PostgreSQL' }).click();
  await dialog().getByLabel('Nombre', { exact: true }).fill('PG Local');
  await dialog().getByLabel('Host').fill(pg.host);
  await dialog().getByLabel('Puerto').fill(String(pg.port));
  await dialog().getByLabel('Base de datos (opcional)').fill(pg.database);
  await dialog().getByLabel('Usuario').fill(pg.user);
  await dialog().getByLabel('Contraseña', { exact: true }).fill(pg.password);
  await dialog().getByRole('button', { name: 'Guardar' }).click();
  await tree()
    .getByRole('treeitem', { name: /PG Local/ })
    .click();
  await page.keyboard.press('Control+N');
  await expect(page.getByTestId('editor-tab').filter({ hasText: 'Script-1' })).toBeVisible();
  await expect(editor().locator('.monaco-editor')).toBeVisible();
  expect(existsSync(join(workspace, 'Script-1.sql'))).toBe(true);
  await expect(page.getByTestId('connection-chip')).toContainText('PG Local');
});

test('ejecuta la sentencia bajo el cursor con Ctrl+Enter y muestra la grilla', async () => {
  await typeInEditor('select 1 as uno, 2 as dos;\n\nselect 3 as tres;');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('results-footer')).toContainText('1 fila');
  await expect(page.getByRole('tab', { name: /Resultado 1/ })).toBeVisible();
  await shot('m3-ejecucion');
});

async function clipboard(): Promise<string> {
  return app.evaluate(({ clipboard: cb }) => cb.readText());
}

/** Clic en la grilla (canvas) en coordenadas relativas a su esquina superior izquierda. */
async function clickGrid(x: number, y: number, modifiers: ('Control' | 'Shift')[] = []): Promise<void> {
  const grid = page.getByTestId('results-grid');
  // Glide mide el canvas de forma asíncrona al montarse.
  await expect
    .poll(async () => (await grid.locator('canvas').first().boundingBox())?.width ?? 0)
    .toBeGreaterThan(100);
  const box = await grid.boundingBox();
  if (!box) throw new Error('Grilla no visible');
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(box.x + x, box.y + y);
  for (const m of modifiers) await page.keyboard.up(m);
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="results-grid"]')))
    .toBe(true);
}

async function run(sql: string, shortcut = 'Control+Enter'): Promise<void> {
  await typeInEditor(sql);
  await page.keyboard.press(shortcut);
}

test('numeric y timestamp se muestran y copian sin pérdida ni cambio de zona', async () => {
  await run(
    "select 12345678901234.123456::numeric as importe, '2026-09-30 08:42:52.658'::timestamp as creado, null::text as nada;",
  );
  await expect(page.getByTestId('results-grid')).toHaveAttribute('data-columns', 'importe,creado,nada');
  // Fila 1, columna "importe" (marcador de fila de 48 px; importe ocupa 160 px).
  await clickGrid(48 + 80, 26 + 12);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+C');
  await expect.poll(clipboard).toBe('12345678901234.123456\t2026-09-30 08:42:52.658\t\r\n');
});

test('Ctrl+Shift+C con dos columnas no contiguas copia solo esas columnas con cabeceras', async () => {
  await run("select g as a, 'x' || g as b, g * 10 as c, 'y' as d from generate_series(1, 3) g;");
  await expect(page.getByTestId('results-grid')).toHaveAttribute('data-columns', 'a,b,c,d');
  await expect(page.getByTestId('results-footer')).toContainText('3 filas');
  // Anchos por defecto: a y c enteros (90 px), b y d texto (160 px).
  await clickGrid(48 + 30, 13);
  await clickGrid(48 + 90 + 160 + 30, 13, ['Control']);
  await page.keyboard.press('Control+Shift+C');
  await expect.poll(clipboard).toBe('a\tc\r\n1\t10\r\n2\t20\r\n3\t30\r\n');
});

test('"Copiar tabla (con cabeceras)" copia todas las filas aunque haya una sola celda seleccionada', async () => {
  await clickGrid(48 + 30, 26 + 12);
  await page.getByTestId('export-menu').click();
  await page.getByRole('menuitem', { name: 'Copiar tabla (con cabeceras)' }).click();
  await expect.poll(clipboard).toBe('a\tb\tc\td\r\n1\tx1\t10\ty\r\n2\tx2\t20\ty\r\n3\tx3\t30\ty\r\n');
});

test('respeta el límite y "Cargar más" trae el siguiente lote', async () => {
  await run('select g from generate_series(1, 1200) g;');
  await expect(page.getByTestId('results-grid')).toHaveAttribute('data-columns', 'g');
  const footer = page.getByTestId('results-footer');
  await expect(footer).toContainText('500 filas (truncado');
  await footer.getByRole('button', { name: 'Cargar más' }).click();
  await expect(footer).toContainText('1000 filas (truncado');
  await footer.getByRole('button', { name: 'Cargar todo' }).click();
  await expect(footer).toContainText('1200 filas');
  await expect(footer).not.toContainText('truncado');
});

test('SELECT de 200 000 filas sin límite no congela la interfaz', async () => {
  await page.getByLabel('Límite').selectOption('all');
  await typeInEditor('select g, md5(g::text) as h from generate_series(1, 200000) g;');
  await page.keyboard.press('Control+Enter');
  // Mientras llegan los lotes, la UI sigue pintando cuadros.
  let slowest = 0;
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
    slowest = Math.max(slowest, Date.now() - start);
  }
  await expect(page.getByTestId('results-footer')).toContainText(/200.000 filas/, { timeout: 60_000 });
  expect(slowest).toBeLessThan(1000);
  await page.getByLabel('Límite').selectOption('500');
});

test('cancela SELECT pg_sleep(30)', async () => {
  await typeInEditor('select pg_sleep(30);');
  const started = Date.now();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('execution-timer')).toBeVisible();
  await page.keyboard.press('Control+Shift+Q');
  await expect(page.getByTestId('messages')).toContainText('cancelada', { timeout: 10_000 });
  expect(Date.now() - started).toBeLessThan(10_000);
  await expect(page.getByTestId('execution-timer')).toHaveCount(0);
});

test('un error se marca en el editor y en Mensajes con "Ir a la línea"', async () => {
  await run('select 1;\nselect nocolumna from dbx.clientes;', 'Alt+X');
  await expect(page.getByTestId('messages')).toContainText('nocolumna');
  await expect(page.getByTestId('messages').getByRole('button', { name: 'Ir a la línea 2' })).toBeVisible();
  await expect(editor().locator('.squiggly-error')).toHaveCount(1);
  await expect(editor().locator('.statement-ok')).toHaveCount(1);
  await expect(editor().locator('.statement-error')).toHaveCount(1);
  await shot('m3-error');
});

test('UPDATE sin WHERE pide confirmación y se puede cancelar', async () => {
  await run('update dbx.clientes set nombre = nombre;');
  await expect(dialog()).toContainText('Sentencia sin WHERE');
  await dialog().getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog()).toHaveCount(0);
  await expect(page.getByTestId('execution-timer')).toHaveCount(0);
});

test('guardado automático: 5 s sin escribir y al ejecutar', async () => {
  const file = join(workspace, 'Script-1.sql');
  await typeInEditor('select 42 as autoguardado;');
  await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 8000 }).toBe('select 42 as autoguardado;');
  await typeInEditor('select 43 as al_ejecutar;');
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('results-grid')).toHaveAttribute('data-columns', 'al_ejecutar');
  expect(readFileSync(file, 'utf8')).toBe('select 43 as al_ejecutar;');
});

test('un cambio externo no se pisa con el guardado automático', async () => {
  const file = join(workspace, 'Script-1.sql');
  writeFileSync(file, 'cambio externo');
  utimesSync(file, new Date(), new Date(Date.now() + 60_000));
  await typeInEditor('select 44;');
  await expect(page.getByText('Script-1.sql cambió en disco')).toBeVisible({ timeout: 8000 });
  expect(readFileSync(file, 'utf8')).toBe('cambio externo');
  await page.getByRole('button', { name: 'Sobrescribir' }).click();
  await expect.poll(() => readFileSync(file, 'utf8')).toBe('select 44;');
});

test('cerrar la pestaña de un script vacío elimina el archivo', async () => {
  await page.keyboard.press('Control+N');
  await expect(page.getByTestId('editor-tab').filter({ hasText: 'Script-2' })).toBeVisible();
  expect(existsSync(join(workspace, 'Script-2.sql'))).toBe(true);
  await page.keyboard.press('Control+W');
  await expect(page.getByTestId('editor-tab').filter({ hasText: 'Script-2' })).toHaveCount(0);
  await expect.poll(() => existsSync(join(workspace, 'Script-2.sql'))).toBe(false);
});

test('Alt+F4 antes de 5 s guarda, y al reabrir se restauran pestaña, cursor y conexión', async () => {
  await typeInEditor('select 1;\nselect 2 as ultima;');
  await page.keyboard.press('End');
  // Alt+F4 lo resuelve Windows enviando el evento close a la ventana: se simula ese mismo evento.
  const closed = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await closed;
  expect(readFileSync(join(workspace, 'Script-1.sql'), 'utf8')).toBe('select 1;\r\nselect 2 as ultima;');
  await start();
  await expect(page.getByTestId('editor-tab').filter({ hasText: 'Script-1' })).toBeVisible();
  await expect(page.getByTestId('connection-chip')).toContainText('PG Local');
  await expect(page.getByTestId('cursor-position')).toHaveText('Ln 2, Col 20');
});

test('en Producción confirma antes de ejecutar escrituras y tiñe la status bar', async () => {
  await page.getByRole('button', { name: 'Nueva conexión' }).first().click();
  await dialog().getByRole('button', { name: 'PostgreSQL' }).click();
  await dialog().getByLabel('Nombre', { exact: true }).fill('PG Prod');
  await dialog().getByLabel('Entorno').selectOption({ label: 'Producción' });
  await dialog().getByLabel('Host').fill(pg.host);
  await dialog().getByLabel('Puerto').fill(String(pg.port));
  await dialog().getByLabel('Base de datos (opcional)').fill(pg.database);
  await dialog().getByLabel('Usuario').fill(pg.user);
  await dialog().getByLabel('Contraseña', { exact: true }).fill(pg.password);
  await dialog().getByRole('button', { name: 'Guardar' }).click();
  await tree()
    .getByRole('treeitem', { name: /PG Prod/ })
    .click();
  await page.keyboard.press('Control+N');
  await expect(page.getByTestId('connection-chip')).toContainText('PG Prod');
  await expect(page.getByTestId('statusbar')).toHaveClass(/is-prod/);

  // Una lectura no pide confirmación.
  await run('select 1 as lectura;');
  await expect(page.getByTestId('results-grid')).toHaveAttribute('data-columns', 'lectura');

  await run('create temp table t_prod (a int);');
  await expect(dialog()).toContainText('Confirmar ejecución en Producción');
  await expect(dialog()).toContainText('PG Prod');
  await dialog().getByRole('button', { name: 'Ejecutar' }).click();
  await expect(page.getByTestId('messages')).toContainText('CREATE');
  await shot('m3-produccion');
});

/** Texto visible del editor (Monaco usa espacios duros). */
async function editorText(): Promise<string> {
  const text = await editor().locator('.view-lines').innerText();
  return text.replace(/\u00a0/g, ' ');
}

test('atajos del editor: acordes de Monaco, comentar, insertar línea y selectores', async () => {
  await typeInEditor('select a');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+K');
  await page.keyboard.press('Control+U');
  await expect.poll(editorText).toBe('SELECT A');
  await page.keyboard.press('Control+K');
  await page.keyboard.press('Control+L');
  await expect.poll(editorText).toBe('select a');
  await page.keyboard.press('Control+/');
  await expect.poll(editorText).toBe('-- select a');
  // Ctrl+Enter ejecuta; "insertar línea debajo" queda en Ctrl+Alt+Enter.
  await page.keyboard.press('Control+Alt+Enter');
  await expect(editor().locator('.view-line')).toHaveCount(2);

  await page.keyboard.press('Control+9');
  await expect(page.getByTestId('quick-input')).toHaveAttribute(
    'placeholder',
    'Elige la conexión de la pestaña',
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+0');
  await expect(page.getByTestId('quick-input')).toHaveAttribute(
    'placeholder',
    'Elige el esquema o la base de datos',
  );
  await expect(page.locator('.quick-input-item').first()).toBeVisible();
  await page.keyboard.press('Escape');

  // Las acciones de Monaco aparecen en la paleta con su id reasignable.
  await page.keyboard.press('Control+Shift+P');
  await page.getByTestId('quick-input').fill('>editor: mayúsculas');
  await expect(page.locator('.quick-input-item').first()).toBeVisible();
  await page.keyboard.press('Escape');
});

test('el cursor queda justo después del último carácter escrito (fuente medida)', async () => {
  await typeInEditor('select * from Contr');
  const gap = await editor().evaluate((root) => {
    const cursor = root.querySelector('.cursors-layer .cursor')!.getBoundingClientRect();
    const spans = root.querySelectorAll('.view-line span span');
    const last = spans[spans.length - 1]!.getBoundingClientRect();
    return Math.abs(cursor.left - last.right);
  });
  expect(gap).toBeLessThan(2);
});
