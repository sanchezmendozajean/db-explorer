import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { join } from 'node:path';
import { launchApp, pgConfig, tempUserData } from './helpers';

/**
 * M8 (specs/12 §7): Ctrl+Alt+E abre la pestaña Plan con el árbol, el detalle
 * del nodo y Ver original; en Producción, Explicar y ejecutar de un UPDATE
 * pide confirmación y después de aceptar los datos no cambian.
 */

test.describe.configure({ mode: 'serial' });

const pg = pgConfig();
const SHOTS = process.env['DBX_SHOTS'];
let app: ElectronApplication;
let page: Page;

const dialog = (): ReturnType<Page['locator']> => page.getByRole('dialog');
const editor = (): ReturnType<Page['locator']> => page.getByTestId('sql-editor');
const planTab = (): ReturnType<Page['locator']> => page.getByRole('tab', { name: /^Plan/ });
const planNodes = (): ReturnType<Page['locator']> => page.getByTestId('plan-node');

async function shot(name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function typeInEditor(text: string): Promise<void> {
  await editor().locator('.view-lines').click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
}

async function waitIdle(): Promise<void> {
  await expect(page.getByTestId('execution-timer')).toHaveCount(0, { timeout: 20_000 });
}

test.beforeAll(async () => {
  app = await launchApp(tempUserData());
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('Error en el renderer:', e.message));
  await page.getByTestId('statusbar').waitFor();
});

test.afterAll(async () => {
  await app?.close();
});

test('prepara una tabla de 20 000 filas en una conexión de Producción', async () => {
  await page.getByRole('button', { name: 'Nueva conexión' }).first().click();
  await dialog().getByRole('button', { name: 'PostgreSQL' }).click();
  await dialog().getByLabel('Nombre', { exact: true }).fill('PG Plan');
  await dialog().getByLabel('Entorno').selectOption({ label: 'Producción' });
  await dialog().getByLabel('Host').fill(pg.host);
  await dialog().getByLabel('Puerto').fill(String(pg.port));
  await dialog().getByLabel('Base de datos (opcional)').fill(pg.database);
  await dialog().getByLabel('Usuario').fill(pg.user);
  await dialog().getByLabel('Contraseña', { exact: true }).fill(pg.password);
  await dialog().getByRole('button', { name: 'Guardar' }).click();
  await page
    .locator('[data-view="connections"] .tree')
    .getByRole('treeitem', { name: /PG Plan/ })
    .click();
  await page.keyboard.press('Control+N');
  await expect(page.getByTestId('connection-chip')).toContainText('PG Plan');

  await typeInEditor(
    'create table dbx.plan_e2e (id int primary key, v int);\n' +
      'insert into dbx.plan_e2e select i, i % 100 from generate_series(1, 20000) i;\n' +
      'analyze dbx.plan_e2e;',
  );
  await page.keyboard.press('Alt+X');
  await dialog().getByRole('button', { name: 'Ejecutar' }).click();
  await waitIdle();
  await expect(page.getByTestId('messages')).not.toContainText('Error');
});

test('Ctrl+Alt+E abre la pestaña Plan con el árbol, el costo y el aviso de recorrido completo', async () => {
  await typeInEditor('select * from dbx.plan_e2e where v = 5');
  await page.keyboard.press('Control+Alt+E');
  // Explicar plan no ejecuta: no pide confirmación aunque la conexión sea de Producción.
  await expect(planTab()).toBeVisible();
  await expect(planTab()).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('plan-kind')).toHaveText('Estimado');
  await expect(page.getByTestId('plan-summary')).toContainText('Costo total');
  await expect(planNodes().first()).toHaveAttribute('data-operation', 'Seq Scan');
  await expect(page.getByTestId('plan-warnings')).toHaveText('1 aviso');
  await shot('m8-plan');
});

test('seleccionar un nodo abre el detalle y Esc lo cierra', async () => {
  await planNodes().first().click();
  const detail = page.getByTestId('plan-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('Filter');
  await expect(detail).toContainText('Recorrido completo de una tabla de 20.000 filas');
  await shot('m8-plan-detalle');
  await page.keyboard.press('Escape');
  await expect(detail).toHaveCount(0);
});

test('Ver original muestra el JSON del motor', async () => {
  await page.getByTestId('plan-view-original').click();
  const raw = page.getByTestId('plan-raw');
  await expect(raw).toHaveAttribute('data-language', 'json');
  await expect(raw.locator('.view-lines')).toContainText('Node Type');
  await page.getByTestId('plan-view-original').click();
  await expect(planNodes().first()).toBeVisible();
});

test('con varias sentencias seleccionadas avisa y no explica', async () => {
  await typeInEditor('select 1;\nselect 2;');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+Alt+E');
  await expect(page.getByText('Selecciona una sola sentencia para ver su plan')).toBeVisible();
});

test('en Producción, Explicar y ejecutar un UPDATE pide confirmación y los datos no cambian', async () => {
  await typeInEditor('update dbx.plan_e2e set v = -1 where id <= 10');
  await page.keyboard.press('Control+Alt+Shift+E');
  await expect(dialog()).toContainText('Confirmar ejecución en Producción');
  await expect(dialog()).toContainText('La sentencia se ejecutará para medir el plan y luego se revertirá.');
  await dialog().getByRole('button', { name: 'Ejecutar' }).click();
  await waitIdle();
  await expect(page.getByTestId('plan-kind')).toHaveText('Real');
  await expect(planTab()).toContainText('Plan (real)');
  await expect(page.getByTestId('plan-summary')).toContainText('Ejecución');

  // Una consulta normal convive con el plan.
  await typeInEditor('select id from dbx.plan_e2e where v = -1');
  await page.keyboard.press('Control+Enter');
  await waitIdle();
  await expect(page.getByTestId('results-footer')).toContainText('0 filas');
  await expect(planTab()).toBeVisible();
  await shot('m8-plan-real');
});

test('cerrar la pestaña Plan la quita', async () => {
  await page.getByTestId('plan-close').click();
  await expect(planTab()).toHaveCount(0);
});
