import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testEnv } from '../integration/test-env';
import { pgConfig } from '../e2e/helpers';
import type { PackagedApp } from './packaged-app';
import { launchPackaged, PACKAGED_EXE } from './packaged-app';

/**
 * Checklist de flujo completo sobre el programa empaquetado (specs/09 M9):
 * conexiones y drivers cargados desde `app.asar`, editor, resultados, plan,
 * pestaña de objeto, Archivos, Preferencias, y cierre y reapertura con la
 * sesión restaurada.
 */

test.describe.configure({ mode: 'serial' });

const pg = pgConfig();
const env = testEnv();
const userData = mkdtempSync(join(tmpdir(), 'dbx-empaquetado-'));
const workspace = join(userData, 'Documents', 'DB Explorer');
let app: PackagedApp;
let page: Page;

const dialog = (): ReturnType<Page['getByRole']> => page.getByRole('dialog');
const tree = (): ReturnType<Page['locator']> => page.locator('[data-view="connections"] .tree');
const node = (name: RegExp): ReturnType<Page['locator']> => tree().getByRole('treeitem', { name });
const editor = (): ReturnType<Page['locator']> => page.getByTestId('sql-editor');

async function typeInEditor(text: string): Promise<void> {
  await editor().locator('.view-lines').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
}

async function runStatement(sql: string): Promise<void> {
  await typeInEditor(sql);
  await page.keyboard.press('Control+Enter');
  await expect(page.getByTestId('execution-timer')).toHaveCount(0, { timeout: 30_000 });
}

function reachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(3000, () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host, () => done(true));
  });
}

test.beforeAll(async () => {
  test.skip(!existsSync(PACKAGED_EXE), 'falta el build empaquetado (npm run test:packaged)');
  app = await launchPackaged(userData);
  page = app.page;
});

test.afterAll(() => app?.kill());

test('arranca el programa empaquetado con la marca de interfaz lista', async () => {
  await expect(page).toHaveTitle(/DB Explorer/);
  expect(await page.evaluate(() => performance.getEntriesByName('dbx-listo').length)).toBe(1);
  await expect(page.getByTestId('watermark')).toBeVisible();
});

test('PostgreSQL: conecta, navega el árbol y ejecuta en un script', async () => {
  await page.getByRole('button', { name: 'Nueva conexión' }).first().click();
  await dialog().getByRole('button', { name: 'PostgreSQL' }).click();
  await dialog().getByLabel('Nombre', { exact: true }).fill('PG Empaquetado');
  await dialog().getByLabel('Host').fill(pg.host);
  await dialog().getByLabel('Puerto').fill(String(pg.port));
  await dialog().getByLabel('Base de datos (opcional)').fill(pg.database);
  await dialog().getByLabel('Usuario').fill(pg.user);
  await dialog().getByLabel('Contraseña', { exact: true }).fill(pg.password);
  await dialog().getByRole('button', { name: 'Probar conexión' }).click();
  await expect(page.getByTestId('test-result')).toContainText(/Conectado — PostgreSQL \d+/);
  await dialog().getByRole('button', { name: 'Guardar' }).click();
  await node(/PG Empaquetado/).dblclick();
  await node(new RegExp(`^${pg.database}`)).dblclick();
  await node(/^dbx$/).dblclick();
  await node(/^Tablas/).dblclick();
  await expect(node(/^clientes/)).toBeVisible();

  await node(/PG Empaquetado/).click();
  await page.keyboard.press('Control+N');
  await runStatement('select 1 as uno, now() as ahora');
  await expect(page.getByTestId('results-grid')).toHaveAttribute('data-columns', 'uno,ahora');
  await expect(page.getByTestId('results-footer')).toContainText('1 fila');
});

test('Explicar plan abre la pestaña Plan', async () => {
  await typeInEditor('select * from dbx.clientes where id = 1');
  await page.keyboard.press('Control+Alt+E');
  await expect(page.getByRole('tab', { name: /^Plan/ })).toBeVisible();
  await expect(page.getByTestId('plan-node').first()).toBeVisible();
});

test('la pestaña de objeto muestra datos y estructura', async () => {
  await node(/^clientes/).dblclick();
  await expect(page.getByTestId('object-view')).toBeVisible();
  await expect(page.getByTestId('results-grid')).toHaveAttribute('data-columns', 'id,nombre');
  await page.getByRole('tab', { name: 'Estructura' }).click();
  await expect(page.getByTestId('structure')).toContainText('Clave primaria');
});

test('SQLite: el hilo de la sesión funciona dentro de app.asar', async () => {
  await page.getByRole('button', { name: 'Nueva conexión' }).first().click();
  await dialog().getByRole('button', { name: 'SQLite' }).click();
  await dialog().getByLabel('Nombre', { exact: true }).fill('SQLite Empaquetado');
  await dialog().getByLabel('Ruta del archivo').fill(join(userData, 'empaquetado.db'));
  await dialog().getByLabel('Crear si no existe').check();
  await dialog().getByRole('button', { name: 'Guardar' }).click();
  await node(/SQLite Empaquetado/).click();
  await page.keyboard.press('Control+N');
  await runStatement("select sqlite_version() as version, 'ñandú' as texto");
  await expect(page.getByTestId('results-grid')).toHaveAttribute('data-columns', 'version,texto');
});

const servers = [
  {
    card: 'SQL Server',
    name: 'SQL Server Empaquetado',
    host: env('MSSQL_HOST', '127.0.0.1')!,
    port: env('MSSQL_PORT', '51433')!,
    user: env('MSSQL_USER', 'sa')!,
    password: env('MSSQL_PASSWORD') ?? env('MSSQL_SA_PASSWORD') ?? '',
    tls: true,
  },
  {
    card: 'MariaDB / MySQL',
    name: 'MariaDB Empaquetado',
    host: env('MARIADB_HOST', '127.0.0.1')!,
    port: env('MARIADB_PORT', '53306')!,
    user: env('MARIADB_USER', 'dbx')!,
    password: env('MARIADB_PASSWORD', '')!,
    tls: false,
  },
  {
    card: 'MariaDB / MySQL',
    name: 'MySQL Empaquetado',
    host: env('MYSQL_HOST', '127.0.0.1')!,
    port: env('MYSQL_PORT', '53307')!,
    user: env('MYSQL_USER', 'dbx')!,
    password: env('MYSQL_PASSWORD', '')!,
    tls: false,
  },
];

for (const s of servers) {
  test(`${s.name}: el driver carga desde app.asar y ejecuta`, async () => {
    test.skip(!(await reachable(s.host, Number(s.port))), `sin servidor en ${s.host}:${s.port}`);
    await page.getByRole('button', { name: 'Nueva conexión' }).first().click();
    await dialog().getByRole('button', { name: s.card }).click();
    await dialog().getByLabel('Nombre', { exact: true }).fill(s.name);
    await dialog().getByLabel('Host').fill(s.host);
    await dialog().getByLabel('Puerto').fill(s.port);
    await dialog().getByLabel('Usuario').fill(s.user);
    await dialog().getByLabel('Contraseña', { exact: true }).fill(s.password);
    if (s.tls) {
      await dialog().getByRole('button', { name: 'SSL/TLS' }).click();
      await dialog().getByLabel('Cifrar').check();
      await dialog().getByLabel('Confiar en el certificado del servidor').check();
    }
    await dialog().getByRole('button', { name: 'Guardar' }).click();
    await node(new RegExp(s.name)).click();
    await page.keyboard.press('Control+N');
    await runStatement("select 'ñandú' as texto");
    await expect(page.getByTestId('results-grid')).toHaveAttribute('data-columns', 'texto');
    await expect(page.getByTestId('statusbar')).toContainText(s.name);
  });
}

test('Archivos muestra los scripts del espacio de trabajo y Preferencias cambia el tema', async () => {
  await page.keyboard.press('Control+Shift+E');
  await expect(page.locator('[data-view="files"]')).toContainText('Script-1.sql');
  await page.keyboard.press('Control+,');
  await page
    .getByTestId('preferences')
    .getByRole('combobox', { name: 'Tema' })
    .selectOption({ label: 'Claro' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.keyboard.press('Control+Shift+D');
});

test('al cerrar guarda y al reabrir restaura las pestañas y las conexiones', async () => {
  await page.getByRole('tab', { name: /^Script-1/ }).click();
  await typeInEditor('select 42 as respuesta');
  await app.close();
  expect(readFileSync(join(workspace, 'Script-1.sql'), 'utf8')).toBe('select 42 as respuesta');
  expect(existsSync(join(userData, 'connections.json'))).toBe(true);
  // Las contraseñas no quedan en texto plano (specs/08).
  expect(readFileSync(join(userData, 'connections.json'), 'utf8')).not.toContain(pg.password);

  app = await launchPackaged(userData);
  page = app.page;
  await expect(page.getByTestId('editor-tab').filter({ hasText: 'Script-1' })).toBeVisible();
  await expect(node(/PG Empaquetado/)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await app.close();
});
