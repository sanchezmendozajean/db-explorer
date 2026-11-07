import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const SHOTS = process.env['DBX_SHOTS'];
import { launchApp, tempUserData } from './helpers';

/**
 * M10 (specs/13), SQLite: abrir el diagrama desde el árbol, mover una caja (las líneas la siguen y la
 * posición se recuerda al reiniciar), zoom y exportar a SVG en el espacio de trabajo sin sobrescribir.
 */

test.describe.configure({ mode: 'serial' });

const userData = tempUserData();
const workspace = join(userData, 'Documents', 'DB Explorer');
const dbFile = join(userData, 'er.db');
let app: ElectronApplication;
let page: Page;

const box = (name: string): ReturnType<Page['locator']> => page.locator(`[data-box="${name}"]`);
const edges = (): ReturnType<Page['locator']> => page.locator('[data-edge]');
const tree = (): ReturnType<Page['locator']> => page.locator('[data-view="connections"] .tree');

async function start(): Promise<void> {
  app = await launchApp(userData);
  page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('Error en el renderer:', e.message));
  await page.getByTestId('statusbar').waitFor();
}

async function openDiagramFromConnection(): Promise<void> {
  await tree()
    .getByRole('treeitem', { name: /ER SQLite/ })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Ver diagrama' }).click();
  await expect(page.getByTestId('diagram-svg')).toBeVisible();
  await expect(box('pedidos')).toBeVisible();
}

/** Posición (en el lienzo) de una caja: el `translate` de su grupo. */
async function boxPosition(name: string): Promise<string | null> {
  return box(name).getAttribute('transform');
}

test.beforeAll(async () => {
  mkdirSync(workspace, { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL);
    CREATE TABLE pedidos (id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES clientes (id), nota TEXT);
    CREATE TABLE detalle (pedido_id INTEGER NOT NULL REFERENCES pedidos (id), linea INTEGER NOT NULL, PRIMARY KEY (pedido_id, linea));
    CREATE TABLE suelta (id INTEGER PRIMARY KEY);
  `);
  db.close();
  writeFileSync(
    join(userData, 'connections.json'),
    JSON.stringify({
      version: 1,
      folders: [],
      connections: [
        {
          id: 'er-1',
          name: 'ER SQLite',
          engine: 'sqlite',
          environment: 'local',
          file: dbFile,
          savePassword: false,
          readOnly: false,
          confirmWrites: false,
          connectTimeoutSec: 15,
          queryTimeoutSec: 0,
          showSystemObjects: false,
        },
      ],
    }),
  );
  await start();
});

test.afterAll(async () => {
  await app?.close();
});

test('Ver diagrama en la conexión SQLite dibuja las tablas y sus relaciones', async () => {
  await openDiagramFromConnection();
  for (const name of ['clientes', 'pedidos', 'detalle', 'suelta']) await expect(box(name)).toBeVisible();
  // pedidos → clientes y detalle → pedidos.
  await expect(edges()).toHaveCount(2);
  await expect(box('pedidos')).toContainText('cliente_id');
  await expect(box('pedidos')).toContainText('FK');
  await expect(box('clientes')).toContainText('PK');
  await expect(page.getByRole('tab', { name: /Diagrama/ })).toHaveAttribute('aria-selected', 'true');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'm10-diagrama.png') });
});

test('la caja con cursor o selección se resalta en celeste y las demás no se atenúan', async () => {
  await box('clientes').locator('rect.er-head').click();
  await expect(box('clientes')).toHaveClass(/is-active/);
  for (const name of ['pedidos', 'detalle', 'suelta']) {
    await expect(box(name)).not.toHaveClass(/is-active/);
    await expect(box(name)).toHaveCSS('opacity', '1');
  }
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'm10-diagrama-seleccion.png') });
  await box('pedidos').hover();
  await expect(box('pedidos')).toHaveClass(/is-active/);
  await expect(box('clientes')).not.toHaveClass(/is-active/);
});

test('arrastrar una caja la mueve y las líneas conectadas la siguen', async () => {
  const before = await box('pedidos').boundingBox();
  const pathsBefore = await page
    .locator('[data-edge] path.er-line')
    .evaluateAll((els) => els.map((e) => e.getAttribute('d')));
  const header = await box('pedidos').locator('rect.er-head').boundingBox();
  expect(before && header).toBeTruthy();
  const x = header!.x + header!.width / 2;
  const y = header!.y + header!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 40, { steps: 4 });
  await page.mouse.move(x + 160, y + 120, { steps: 4 });
  await page.mouse.up();
  const after = await box('pedidos').boundingBox();
  expect(Math.abs(after!.x - before!.x - 160)).toBeLessThanOrEqual(3);
  expect(Math.abs(after!.y - before!.y - 120)).toBeLessThanOrEqual(3);
  const pathsAfter = await page
    .locator('[data-edge] path.er-line')
    .evaluateAll((els) => els.map((e) => e.getAttribute('d')));
  expect(pathsAfter).not.toEqual(pathsBefore);
});

test('el zoom cambia el nivel y Ajustar lo recalcula', async () => {
  const level = page.locator('.diagram-zoom');
  const initial = await level.innerText();
  await page.getByRole('button', { name: 'Acercar' }).click();
  await page.getByRole('button', { name: 'Acercar' }).click();
  await expect(level).not.toHaveText(initial);
  const zoomed = parseInt((await level.innerText()).replace(/\D/g, ''), 10);
  expect(zoomed).toBeGreaterThan(parseInt(initial.replace(/\D/g, ''), 10));
  await page.getByRole('button', { name: 'Ajustar el diagrama a la ventana' }).click();
  await expect(level).toHaveText(initial);
});

test('con el diagrama enfocado, Ctrl+- aleja en lugar de reducir la ventana', async () => {
  const level = page.locator('.diagram-zoom');
  const start = parseInt((await level.innerText()).replace(/\D/g, ''), 10);
  await box('clientes').click();
  await page.keyboard.press('Control+-');
  await expect
    .poll(async () => parseInt((await level.innerText()).replace(/\D/g, ''), 10))
    .toBeLessThan(start);
});

test('exportar guarda el SVG en el espacio de trabajo y no sobrescribe', async () => {
  await page.getByTestId('diagram-export').click();
  const first = join(workspace, 'Diagrama-ER SQLite.svg');
  await expect.poll(() => existsSync(first)).toBe(true);
  await expect(page.getByText('Diagrama guardado en Diagrama-ER SQLite.svg')).toBeVisible();
  const svg = readFileSync(first, 'utf8');
  expect(svg.startsWith('<?xml')).toBe(true);
  for (const name of ['clientes', 'pedidos', 'detalle', 'suelta'])
    expect(svg).toContain(`data-box="${name}"`);
  // Colores del tema ya resueltos: el archivo no depende de variables CSS.
  expect(svg).not.toContain('var(--');
  expect(svg).toContain('<text');

  await page.getByTestId('diagram-export').click();
  await expect.poll(() => existsSync(join(workspace, 'Diagrama-ER SQLite-2.svg'))).toBe(true);
  expect(
    readdirSync(workspace)
      .filter((f) => f.endsWith('.svg'))
      .sort(),
  ).toEqual(['Diagrama-ER SQLite-2.svg', 'Diagrama-ER SQLite.svg']);

  // La acción de la notificación lleva a la vista Archivos, donde el archivo ya aparece.
  await page.getByRole('button', { name: 'Mostrar en Archivos' }).first().click();
  await expect(
    page
      .locator('[data-view="files"] .tree')
      .getByRole('treeitem', { name: 'Diagrama-ER SQLite.svg', exact: true }),
  ).toBeVisible();
});

test('la posición movida se recuerda al reiniciar la aplicación', async () => {
  const moved = await boxPosition('pedidos');
  const untouched = await boxPosition('suelta');
  // El estado se guarda con un retraso de 250 ms: se espera a que llegue a disco antes de cerrar.
  await page.waitForTimeout(600);
  await app.close();
  await start();
  // La vista Archivos quedó como última vista de la barra lateral (se recuerda al reiniciar).
  await page.keyboard.press('Control+Shift+D');
  await tree()
    .getByRole('treeitem', { name: /ER SQLite/ })
    .waitFor();
  await openDiagramFromConnection();
  expect(await boxPosition('pedidos')).toBe(moved);
  expect(await boxPosition('suelta')).toBe(untouched);
});

test('Reorganizar vuelve a la disposición automática', async () => {
  const moved = await boxPosition('pedidos');
  await page.getByRole('button', { name: /Descartar las posiciones movidas a mano/ }).click();
  await expect.poll(() => boxPosition('pedidos')).not.toBe(moved);
});

test.describe('archivo de diagrama (.dbxdiagram)', () => {
  const file = join(workspace, 'Diagrama-ER SQLite.dbxdiagram');
  const readFile = (): { positions: Record<string, [number, number]>; tables: { name: string }[] } =>
    JSON.parse(readFileSync(file, 'utf8')) as {
      positions: Record<string, [number, number]>;
      tables: { name: string }[];
    };

  test('abrir el diagrama ya lo guardó en el espacio de trabajo, como un script nuevo', async () => {
    // Sin pulsar nada: el archivo se creó al cargar el diagrama (primer test del archivo).
    expect(existsSync(file)).toBe(true);
    expect(
      readFile()
        .tables.map((t) => t.name)
        .sort(),
    ).toEqual(['clientes', 'detalle', 'pedidos', 'suelta']);
    // La prueba anterior acababa de reorganizar: el archivo se pone al día solo (sin posiciones movidas a mano).
    await expect.poll(() => readFile().positions).toEqual({});
    // La pestaña pasa a llamarse como el archivo y no hay botón de guardar: se guarda solo.
    await expect(page.getByRole('tab', { name: /Diagrama-ER SQLite/ }).first()).toBeVisible();
    await expect(page.getByTestId('diagram-save')).toHaveCount(0);
  });

  test('Ctrl+S con el diagrama enfocado guarda y avisa', async () => {
    await box('clientes').click();
    await page.keyboard.press('Control+S');
    await expect(page.getByText('Diagrama guardado: Diagrama-ER SQLite.dbxdiagram')).toBeVisible();
  });

  test('después de guardar, mover una caja actualiza el archivo sola', async () => {
    const before = readFile().positions['clientes'];
    const header = await box('clientes').locator('rect.er-head').boundingBox();
    const x = header!.x + header!.width / 2;
    const y = header!.y + header!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 40, y + 70, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => readFile().positions['clientes']).not.toEqual(before);
  });

  test('cerrar la pestaña y abrir el archivo desde Archivos vuelve a dibujar el diagrama', async () => {
    const moved = readFile().positions['clientes'];
    await page
      .getByRole('tab', { name: /Diagrama-ER SQLite/ })
      .first()
      .getByRole('button', { name: 'Cerrar' })
      .click();
    await expect(page.getByTestId('diagram-svg')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+E');
    await page
      .locator('[data-view="files"] .tree')
      .getByRole('treeitem', { name: 'Diagrama-ER SQLite.dbxdiagram', exact: true })
      .dblclick();
    await expect(page.getByTestId('diagram-svg')).toBeVisible();
    for (const name of ['clientes', 'pedidos', 'detalle', 'suelta']) await expect(box(name)).toBeVisible();
    await expect(edges()).toHaveCount(2);
    const placed = await boxPosition('clientes');
    expect(placed).toContain(`${moved![0]} ${moved![1]}`);
  });

  test('Ver diagrama desde el árbol reabre el archivo existente en vez de crear otro', async () => {
    await page
      .getByRole('tab', { name: /Diagrama-ER SQLite/ })
      .first()
      .getByRole('button', { name: 'Cerrar' })
      .click();
    await expect(page.getByTestId('diagram-svg')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+D');
    await openDiagramFromConnection();
    const files = readdirSync(workspace).filter((n) => n.endsWith('.dbxdiagram'));
    expect(files).toEqual(['Diagrama-ER SQLite.dbxdiagram']);
    // Conserva las posiciones guardadas.
    const moved = readFile().positions['clientes'];
    expect(await boxPosition('clientes')).toContain(`${moved![0]} ${moved![1]}`);
  });

  test('un archivo de otra conexión se dibuja sin conexión y no permite actualizar', async () => {
    const orphan = JSON.parse(readFileSync(file, 'utf8')) as { connection: { id: string; name: string } };
    orphan.connection = { ...orphan.connection, id: 'no-existe', name: 'Conexión borrada' };
    const orphanFile = join(workspace, 'Huérfano.dbxdiagram');
    writeFileSync(orphanFile, JSON.stringify(orphan));
    await page.keyboard.press('Control+Shift+E');
    await expect(
      page
        .locator('[data-view="files"] .tree')
        .getByRole('treeitem', { name: 'Huérfano.dbxdiagram', exact: true }),
    ).toBeVisible();
    await page
      .locator('[data-view="files"] .tree')
      .getByRole('treeitem', { name: 'Huérfano.dbxdiagram', exact: true })
      .dblclick();
    await expect(page.getByText('Copia guardada')).toBeVisible();
    await expect(box('pedidos')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /la conexión de este diagrama ya no existe/i }),
    ).toBeDisabled();
  });

  test('un archivo dañado avisa y no abre la pestaña', async () => {
    writeFileSync(join(workspace, 'Roto.dbxdiagram'), '{ nada');
    await page
      .locator('[data-view="files"] .tree')
      .getByRole('treeitem', { name: 'Roto.dbxdiagram', exact: true })
      .dblclick();
    await expect(page.getByText(/Roto\.dbxdiagram: El archivo no es un JSON válido/)).toBeVisible();
  });
});
