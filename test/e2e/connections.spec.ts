import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, pgConfig, tempUserData } from './helpers';

const pg = pgConfig();
const userData = tempUserData();
let app: ElectronApplication;
let page: Page;

test.describe.configure({ mode: 'serial' });

async function start(): Promise<void> {
  app = await launchApp(userData);
  page = await app.firstWindow();
  await page.getByTestId('statusbar').waitFor();
}

const tree = (): ReturnType<Page['locator']> => page.locator('[data-view="connections"] .tree');
const node = (name: string | RegExp): ReturnType<Page['locator']> => tree().getByRole('treeitem', { name });
const dialog = (): ReturnType<Page['locator']> => page.getByRole('dialog');

async function fillConnection(
  name: string,
  options: { environment?: string; savePassword?: boolean } = {},
): Promise<void> {
  await dialog().getByRole('button', { name: 'PostgreSQL' }).click();
  await dialog().getByLabel('Nombre', { exact: true }).fill(name);
  if (options.environment) await dialog().getByLabel('Entorno').selectOption({ label: options.environment });
  await dialog().getByLabel('Host').fill(pg.host);
  await dialog().getByLabel('Puerto').fill(String(pg.port));
  await dialog().getByLabel('Base de datos (opcional)').fill(pg.database);
  await dialog().getByLabel('Usuario').fill(pg.user);
  if (options.savePassword === false) await dialog().getByText('Guardar contraseña').click();
  else await dialog().getByLabel('Contraseña', { exact: true }).fill(pg.password);
}

/** Todos los archivos de userData, recursivamente. */
function allFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...allFiles(full));
    else out.push(full);
  }
  return out;
}

test.beforeAll(start);

test.afterAll(async () => {
  await app?.close();
});

test('sin conexiones muestra el estado vacío', async () => {
  await expect(page.getByText('Aún no hay conexiones')).toBeVisible();
});

test('crea una conexión PostgreSQL y la prueba desde el diálogo', async () => {
  await page.getByRole('button', { name: 'Nueva conexión' }).first().click();
  await fillConnection('PG Pruebas', { environment: 'Producción' });
  await dialog().getByRole('button', { name: 'Probar conexión' }).click();
  await expect(page.getByTestId('test-result')).toContainText(/Conectado — PostgreSQL \d+/);
  await dialog().getByRole('button', { name: 'Guardar' }).click();
  await expect(dialog()).toHaveCount(0);
  await expect(node(/PG Pruebas/)).toBeVisible();
});

test('conecta y navega bases → esquemas → tablas → columnas', async () => {
  await node(/PG Pruebas/).dblclick();
  await node(new RegExp(`^${pg.database}`)).dblclick();
  await node(/^dbx$/).dblclick();
  await node(/^Tablas/).dblclick();
  await expect(node(/^Tablas/)).toContainText('(2)');
  // Doble clic en una tabla abre su pestaña de objeto: se expande con la flecha.
  await node(/CRendiciones_Conf_Generales/).click();
  await page.keyboard.press('ArrowRight');
  await expect(node(/^id/)).toContainText('integer · NOT NULL');
  await expect(node(/^Nombre/)).toBeVisible();
  await expect(node(/^Índices/)).toContainText('(2)');
});

test('el filtro solo se aplica a los objetos y deja ver sus ancestros', async () => {
  const filter = page.getByPlaceholder('Filtrar (tablas, vistas…)');
  await filter.fill('client');
  await expect(node(/^clientes/)).toBeVisible();
  await expect(node(/CRendiciones_Conf_Generales/)).toHaveCount(0);
  await expect(node(/PG Pruebas/)).toBeVisible();
  // Una tabla que coincide conserva sus columnas.
  await filter.fill('conf');
  await expect(node(/^Nombre/)).toBeVisible();
  // Las conexiones no se filtran por su nombre ni desaparecen.
  await filter.fill('PG Pruebas');
  await expect(node(/PG Pruebas/)).toBeVisible();
  await expect(node(/CRendiciones_Conf_Generales/)).toHaveCount(0);
  await filter.press('Escape');
  await expect(node(/^Nombre/)).toBeVisible();
});

test('edita, duplica y elimina conexiones', async () => {
  await node(/PG Pruebas/).click();
  await tree().press('F4');
  await expect(dialog()).toContainText('Editar conexión');
  await expect(dialog().getByLabel('Contraseña', { exact: true })).toHaveAttribute('placeholder', /guardada/);
  await dialog().getByLabel('Nombre', { exact: true }).fill('PG Principal');
  await dialog().getByRole('button', { name: 'Guardar' }).click();
  await expect(node(/PG Principal/)).toBeVisible();

  await node(/PG Principal/).click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Duplicar' }).click();
  await expect(node(/PG Principal \(copia\)/)).toBeVisible();

  await node(/PG Principal \(copia\)/).click();
  await tree().press('Delete');
  await expect(dialog()).toContainText('¿Eliminar la conexión');
  await dialog().getByRole('button', { name: 'Eliminar' }).click();
  await expect(node(/\(copia\)/)).toHaveCount(0);
});

test('crea una carpeta y mueve la conexión adentro', async () => {
  await page.getByRole('button', { name: 'Nueva carpeta' }).click();
  await dialog().getByLabel('Nombre de la carpeta').fill('Producción');
  await dialog().getByRole('button', { name: 'Crear' }).click();
  await expect(node(/^Producción/)).toBeVisible();

  await node(/PG Principal/).click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Mover a carpeta' }).hover();
  await page.locator('.menu-item', { hasText: /^Producción$/ }).click();
  await node(/^Producción/).dblclick();
  const folderBox = (await node(/^Producción/).boundingBox())!;
  const connBox = (await node(/PG Principal/).boundingBox())!;
  expect(connBox.y).toBeGreaterThan(folderBox.y);
  expect(connBox.x).toBe(folderBox.x); // misma fila base; la sangría va dentro de la fila
});

test('sin contraseña guardada la pide al conectar', async () => {
  await page.getByRole('button', { name: 'Nueva conexión' }).first().click();
  await fillConnection('PG Sin clave', { savePassword: false });
  await dialog().getByRole('button', { name: 'Guardar' }).click();
  await node(/PG Sin clave/).dblclick();
  await expect(dialog()).toContainText('Contraseña de PG Sin clave');
  await dialog().getByLabel('Contraseña', { exact: true }).fill(pg.password);
  await dialog().getByRole('button', { name: 'Conectar' }).click();
  await expect(node(new RegExp(`^${pg.database}`)).first()).toBeVisible();
});

test('una contraseña incorrecta muestra el error en el nodo', async () => {
  await node(/PG Sin clave/).click({ button: 'right' });
  await page.locator('.menu-item', { hasText: 'Desconectar' }).click();
  await node(/PG Sin clave/).dblclick();
  await dialog().getByLabel('Contraseña', { exact: true }).fill('incorrecta');
  await dialog().getByRole('button', { name: 'Conectar' }).click();
  await expect(node(/PG Sin clave/).getByTestId('tree-error')).toBeVisible();
  await expect(page.locator('.toast')).toContainText('No se pudo conectar');
});

test('arrastrar una conexión sobre una carpeta la mueve adentro', async () => {
  await node(/PG Sin clave/).dragTo(node(/^Producción/));
  // Dentro de la carpeta: queda debajo de PG Principal y con más sangría que la carpeta.
  const folder = (await node(/^Producción/)
    .locator('.tree-twistie')
    .boundingBox())!;
  const moved = (await node(/PG Sin clave/)
    .locator('.env-dot')
    .boundingBox())!;
  expect(moved.x).toBeGreaterThan(folder.x);
  const principal = (await node(/PG Principal/).boundingBox())!;
  expect((await node(/PG Sin clave/).boundingBox())!.y).toBeGreaterThan(principal.y);
});

test('las conexiones persisten y la contraseña guardada no está en texto plano', async () => {
  await app.close();

  const needles = [Buffer.from(pg.password, 'utf8'), Buffer.from(pg.password, 'utf16le')];
  const leaks = allFiles(userData).filter((file) => {
    const data = readFileSync(file);
    return needles.some((n) => data.includes(n));
  });
  expect(leaks).toEqual([]);
  expect(readFileSync(join(userData, 'connections.json'), 'utf8')).not.toContain('password');

  await start();
  await expect(node(/^Producción/)).toBeVisible();
  await node(/^Producción/).dblclick();
  await node(/PG Principal/).dblclick();
  // Usa la contraseña guardada: no aparece el diálogo.
  await expect(node(new RegExp(`^${pg.database}`)).first()).toBeVisible();
  await expect(dialog()).toHaveCount(0);
});
