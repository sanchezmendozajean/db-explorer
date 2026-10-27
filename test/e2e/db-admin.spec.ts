import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findPgBin } from '../integration/pg-server';
import { launchApp, pgConfig, tempUserData } from './helpers';

/**
 * Administración de bases (crear, renombrar, eliminar, respaldar y restaurar) sobre el PostgreSQL de
 * pruebas. El respaldo usa los binarios auxiliares reales (pg_dump/pg_restore de la instalación local):
 * se piden en un diálogo, se copian a la carpeta interna del perfil y se verifican por su versión.
 */

const pg = pgConfig();
const bin = findPgBin();
const userData = tempUserData();
let app: ElectronApplication;
let page: Page;

test.describe.configure({ mode: 'serial' });

const tree = (): ReturnType<Page['locator']> => page.locator('[data-view="connections"] .tree');
const node = (name: string | RegExp): ReturnType<Page['locator']> => tree().getByRole('treeitem', { name });
const dialog = (): ReturnType<Page['locator']> => page.getByRole('dialog');
const menuItem = (name: string): ReturnType<Page['locator']> => page.getByRole('menuitem', { name });

test.beforeAll(async () => {
  app = await launchApp(userData);
  page = await app.firstWindow();
  await page.getByTestId('statusbar').waitFor();
  await page.getByRole('button', { name: 'Nueva conexión' }).first().click();
  await dialog().getByRole('button', { name: 'PostgreSQL' }).click();
  await dialog().getByLabel('Nombre', { exact: true }).fill('PG Admin');
  await dialog().getByLabel('Host').fill(pg.host);
  await dialog().getByLabel('Puerto').fill(String(pg.port));
  await dialog().getByLabel('Base de datos (opcional)').fill(pg.database);
  await dialog().getByLabel('Usuario').fill(pg.user);
  await dialog().getByLabel('Contraseña', { exact: true }).fill(pg.password);
  await dialog().getByRole('button', { name: 'Guardar' }).click();
  await node(/PG Admin/).dblclick();
  await expect(node(new RegExp(`^${pg.database}`))).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
});

test('crea una base desde el menú de la conexión y aparece en el árbol', async () => {
  await node(/PG Admin/).click({ button: 'right' });
  await menuItem('Crear base de datos…').click();
  await dialog().getByLabel('Nombre de la base de datos').fill('dbx_e2e_admin');
  await dialog().getByRole('button', { name: 'Crear' }).click();
  await expect(page.getByText('Se creó la base de datos "dbx_e2e_admin".')).toBeVisible();
  await expect(node(/^dbx_e2e_admin/)).toBeVisible();
});

test('renombra la base con F2', async () => {
  await node(/^dbx_e2e_admin/).click();
  await tree().press('F2');
  await expect(dialog()).toContainText('Renombrar "dbx_e2e_admin"');
  await dialog().getByLabel('Nombre nuevo').fill('dbx_e2e_admin2');
  await dialog().getByRole('button', { name: 'Renombrar' }).click();
  await expect(node(/^dbx_e2e_admin2/)).toBeVisible();
  await expect(node(/^dbx_e2e_admin$/)).toHaveCount(0);
});

test.describe('respaldo con herramientas auxiliares', () => {
  test.skip(!bin || !existsSync(join(bin, 'pg_dump.exe')), 'No hay pg_dump local');
  const target = join(userData, 'respaldo.backup');

  test('pide los binarios, los copia y respalda', async () => {
    await app.evaluate(
      ({ dialog: d }, args) => {
        d.showOpenDialog = (async () => ({ canceled: false, filePaths: args.tools })) as never;
        d.showSaveDialog = (async () => ({ canceled: false, filePath: args.target })) as never;
      },
      { tools: [join(bin!, 'pg_dump.exe'), join(bin!, 'pg_restore.exe')], target },
    );

    await node(/^dbx_e2e_admin2/).click({ button: 'right' });
    await menuItem('Respaldar base de datos…').click();
    await expect(dialog()).toContainText('Herramientas auxiliares de PostgreSQL');
    await expect(dialog()).toContainText('pg_dump.exe');
    await expect(dialog()).toContainText('pg_restore.exe');
    await expect(dialog()).toContainText('carpeta interna del programa');
    await expect(dialog().getByRole('button', { name: 'Continuar' })).toBeDisabled();

    await dialog().getByRole('button', { name: 'Seleccionar archivos…' }).click();
    await expect(dialog().getByTestId('tool-list')).toContainText(/Listo · versión \d+/);
    await expect(dialog().getByTestId('tool-libs').first()).toContainText('libpq.dll');
    await dialog().getByRole('button', { name: 'Continuar' }).click();

    await expect(dialog()).toContainText('Respaldar "dbx_e2e_admin2"');
    await dialog().getByRole('button', { name: 'Examinar…' }).click();
    await expect(dialog().getByTestId('backup-path')).toHaveValue(target);
    await dialog().getByTestId('backup-start').click();
    await expect(page.getByText(/Se respaldó "dbx_e2e_admin2"/)).toBeVisible();
    expect(statSync(target).size).toBeGreaterThan(0);
  });

  test('con las herramientas ya importadas no vuelve a pedirlas y restaura', async () => {
    await app.evaluate(({ dialog: d }, file) => {
      d.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as never;
    }, target);
    await node(/^dbx_e2e_admin2/).click({ button: 'right' });
    await menuItem('Restaurar base de datos…').click();
    await expect(dialog()).toContainText('Restauración de base de datos');
    await expect(dialog()).toContainText('pg_restore.exe');
    await expect(dialog().getByTestId('backup-start')).toBeDisabled();
    // Opciones de pg_restore: la base destino parte de la elegida y las dos casillas, activas.
    await expect(dialog().getByTestId('restore-dbname')).toHaveValue('dbx_e2e_admin2');
    await expect(dialog().getByTestId('restore-no-owner')).toBeChecked();
    await expect(dialog().getByTestId('restore-no-privileges')).toBeChecked();
    await expect(dialog()).toContainText('No restaura el dueño original');
    await expect(dialog()).toContainText('No restaura los permisos');
    await dialog().getByTestId('restore-no-owner').uncheck();
    await expect(dialog()).toContainText('fallará completa');
    await dialog().getByTestId('restore-no-owner').check();
    await dialog().getByRole('button', { name: 'Examinar…' }).click();
    await dialog().getByText('Entiendo que se reemplazarán los datos').click();
    await dialog().getByTestId('backup-start').click();
    await expect(page.getByText('Se restauró la base de datos "dbx_e2e_admin2".')).toBeVisible();
  });
});

test('eliminar exige escribir el nombre de la base', async () => {
  await node(/^dbx_e2e_admin2/).click();
  await tree().press('Delete');
  await expect(dialog()).toContainText('Eliminar base de datos');
  await dialog().getByRole('button', { name: 'Eliminar' }).click();
  await expect(dialog()).toContainText('El nombre no coincide');
  await dialog()
    .getByLabel(/Para confirmar, escribe el nombre/)
    .fill('dbx_e2e_admin2');
  await dialog().getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.getByText('Se eliminó la base de datos "dbx_e2e_admin2".')).toBeVisible();
  await expect(node(/^dbx_e2e_admin2/)).toHaveCount(0);
});

test('el menú de configuración abre la carpeta de las herramientas importadas', async () => {
  // shell.openPath abriría el explorador real: se reemplaza y se anota la ruta recibida.
  await app.evaluate(({ shell }) => {
    (globalThis as { __opened?: string }).__opened = '';
    shell.openPath = (async (path: string) => {
      (globalThis as { __opened?: string }).__opened = path;
      return '';
    }) as never;
  });
  await page.getByRole('button', { name: 'Administrar' }).click();
  await menuItem('Abrir carpeta de herramientas de respaldo').click();
  await expect
    .poll(() => app.evaluate(() => (globalThis as { __opened?: string }).__opened))
    .toBe(join(userData, 'tools'));
});

test('en Producción, renombrar muestra el SQL y solo se aplica al confirmar', async () => {
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
  await node(/PG Prod/).dblclick();
  // Las dos conexiones muestran la base predeterminada: esperar a que la nueva termine de conectar.
  await expect(node(new RegExp(`^${pg.database}`))).toHaveCount(2);

  await node(/PG Prod/).click({ button: 'right' });
  await menuItem('Crear base de datos…').click();
  await dialog().getByLabel('Nombre de la base de datos').fill('dbx_e2e_prod');
  await dialog().getByRole('button', { name: 'Crear' }).click();
  await expect(node(/^dbx_e2e_prod/)).toBeVisible();

  await node(/^dbx_e2e_prod/).click();
  await tree().press('F2');
  await dialog().getByLabel('Nombre nuevo').fill('dbx_e2e_prod2');
  await dialog().getByRole('button', { name: 'Renombrar' }).click();
  // Antes de aplicar: se muestra el SQL y cancelar no cambia nada.
  await expect(dialog()).toContainText('Confirmar ejecución en Producción');
  await expect(dialog()).toContainText('ALTER DATABASE dbx_e2e_prod RENAME TO dbx_e2e_prod2');
  await dialog().getByRole('button', { name: 'Cancelar' }).click();
  await expect(node(/^dbx_e2e_prod(?!2)/)).toBeVisible();

  await tree().press('F2');
  await dialog().getByLabel('Nombre nuevo').fill('dbx_e2e_prod2');
  await dialog().getByRole('button', { name: 'Renombrar' }).click();
  await dialog().getByRole('button', { name: 'Ejecutar' }).click();
  await expect(node(/^dbx_e2e_prod2/)).toBeVisible();

  // Limpieza.
  await node(/^dbx_e2e_prod2/).click();
  await tree().press('Delete');
  await dialog()
    .getByLabel(/Para confirmar/)
    .fill('dbx_e2e_prod2');
  await dialog().getByRole('button', { name: 'Eliminar' }).click();
  await expect(node(/^dbx_e2e_prod2/)).toHaveCount(0);
});
