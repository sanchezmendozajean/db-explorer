import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, pgConfig, tempUserData } from './helpers';

/**
 * M10 (specs/13), PostgreSQL: el diagrama se abre desde el nodo de un esquema, muestra tablas y claves
 * foráneas (una compuesta, leídas de `pg_constraint`) y se guarda solo en el espacio de trabajo.
 */

test.describe.configure({ mode: 'serial' });

const pg = pgConfig();
const userData = tempUserData();
const workspace = join(userData, 'Documents', 'DB Explorer');
let app: ElectronApplication;
let page: Page;

const dialog = (): ReturnType<Page['locator']> => page.getByRole('dialog');
const editor = (): ReturnType<Page['locator']> => page.getByTestId('sql-editor');
const tree = (): ReturnType<Page['locator']> => page.locator('[data-view="connections"] .tree');
const box = (name: string): ReturnType<Page['locator']> => page.locator(`[data-box="${name}"]`);

test.beforeAll(async () => {
  app = await launchApp(userData);
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('Error en el renderer:', e.message));
  await page.getByTestId('statusbar').waitFor();
});

test.afterAll(async () => {
  await app?.close();
});

test('prepara tablas con claves foráneas en PostgreSQL', async () => {
  await page.getByRole('button', { name: 'Nueva conexión' }).first().click();
  await dialog().getByRole('button', { name: 'PostgreSQL' }).click();
  await dialog().getByLabel('Nombre', { exact: true }).fill('PG Diagrama');
  await dialog().getByLabel('Host').fill(pg.host);
  await dialog().getByLabel('Puerto').fill(String(pg.port));
  await dialog().getByLabel('Base de datos (opcional)').fill(pg.database);
  await dialog().getByLabel('Usuario').fill(pg.user);
  await dialog().getByLabel('Contraseña', { exact: true }).fill(pg.password);
  await dialog().getByRole('button', { name: 'Guardar' }).click();
  await tree()
    .getByRole('treeitem', { name: /PG Diagrama/ })
    .click();
  await page.keyboard.press('Control+N');
  await expect(page.getByTestId('connection-chip')).toContainText('PG Diagrama');

  await editor().locator('.view-lines').click();
  await page.keyboard.type(
    'create schema if not exists dbx_er;\n' +
      'drop table if exists dbx_er.hijo; drop table if exists dbx_er.padre;\n' +
      'create table dbx_er.padre (a int not null, b int not null, primary key (a, b));\n' +
      'create table dbx_er.hijo (id int primary key, a int, b int, nota text not null,\n' +
      '  constraint fk_hijo_padre foreign key (a, b) references dbx_er.padre (a, b));',
  );
  await page.keyboard.press('Alt+X');
  await expect(page.getByTestId('execution-timer')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('messages')).not.toContainText('Error');
});

test('Ver diagrama en el esquema muestra las tablas y la clave foránea compuesta', async () => {
  // Conexión → base de datos → esquemas.
  await page.keyboard.press('Control+Shift+D');
  const connection = tree().getByRole('treeitem', { name: /PG Diagrama/ });
  await connection.click();
  await page.keyboard.press('ArrowRight');
  const database = tree().getByRole('treeitem', { name: new RegExp(`^${pg.database}`) });
  await database.click();
  await page.keyboard.press('ArrowRight');
  const schema = tree().getByRole('treeitem', { name: /^dbx_er/ });
  await schema.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Ver diagrama' }).click();

  await expect(page.getByTestId('diagram-svg')).toBeVisible({ timeout: 15_000 });
  await expect(box('padre')).toBeVisible();
  await expect(box('hijo')).toBeVisible();
  await expect(page.locator('[data-edge]')).toHaveCount(1);
  await expect(box('hijo')).toContainText('nota');
  await expect(box('hijo')).toContainText('FK');
  await expect(box('padre')).toContainText('PK');
});

test('el diagrama queda guardado en el espacio de trabajo con la clave compuesta', async () => {
  await expect.poll(() => readdirSync(workspace).filter((n) => n.endsWith('.dbxdiagram'))).toHaveLength(1);
  const file = join(
    workspace,
    readdirSync(workspace).find((n) => n.endsWith('.dbxdiagram'))!,
  );
  expect(existsSync(file)).toBe(true);
  const saved = JSON.parse(readFileSync(file, 'utf8')) as {
    schema: string;
    connection: { engine: string };
    relations: { name: string; from: { columns: string[] }; to: { table: string; columns: string[] } }[];
  };
  expect(saved.connection.engine).toBe('postgres');
  expect(saved.schema).toBe('dbx_er');
  expect(saved.relations).toHaveLength(1);
  expect(saved.relations[0]).toMatchObject({
    name: 'fk_hijo_padre',
    from: { columns: ['a', 'b'] },
    to: { table: 'padre', columns: ['a', 'b'] },
  });
});

test('Ver diagrama desde una tabla centra y selecciona esa tabla', async () => {
  await page
    .getByRole('tab', { name: /Diagrama/ })
    .first()
    .getByRole('button', { name: 'Cerrar' })
    .click();
  const schema = tree().getByRole('treeitem', { name: /^dbx_er/ });
  await schema.click();
  await page.keyboard.press('ArrowRight');
  const tables = tree().getByRole('treeitem', { name: /^Tablas/ });
  await tables.click();
  await page.keyboard.press('ArrowRight');
  await tree().getByRole('treeitem', { name: /^hijo/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Ver diagrama' }).click();
  await expect(box('hijo')).toHaveClass(/is-active/);
  await expect(box('padre')).not.toHaveClass(/is-active/);
  // No crea un segundo archivo: reabre el del esquema.
  expect(readdirSync(workspace).filter((n) => n.endsWith('.dbxdiagram'))).toHaveLength(1);
});

test('limpia las tablas de prueba', async () => {
  await page
    .getByRole('tab', { name: /Script/ })
    .first()
    .click();
  await editor().locator('.view-lines').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type('drop schema dbx_er cascade;');
  await page.keyboard.press('Alt+X');
  await expect(page.getByTestId('execution-timer')).toHaveCount(0, { timeout: 20_000 });
});
