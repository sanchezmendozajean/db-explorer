import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { Socket } from 'node:net';
import { join } from 'node:path';
import { testEnv } from '../integration/test-env';
import { launchApp, tempUserData } from './helpers';

/**
 * Flujo de M3 (conectar, script, ejecutar, varios resultados, error con
 * posición y cancelar) en SQLite, SQL Server y MariaDB (M4). Los motores sin
 * servidor alcanzable se saltan; en servidores de solo lectura no se escribe.
 */

const env = testEnv();
const SHOTS = process.env['DBX_SHOTS'];

function reachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(4000, () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host, () => done(true));
  });
}

interface Flow {
  engine: string;
  name: string;
  fill(dialog: ReturnType<Page['getByRole']>): Promise<void>;
  /** Script con dos sentencias que devuelven resultados (la segunda con columnas `texto,importe`). */
  script: string;
  scriptShortcut: string;
  sleep: string;
  available(): Promise<string | null>;
}

const flows: Flow[] = [
  {
    engine: 'SQLite',
    name: 'SQLite Local',
    async fill(dialog) {
      await dialog.getByLabel('Ruta del archivo').fill(join(tempUserData(), 'e2e.db'));
      await dialog.getByLabel('Crear si no existe').check();
    },
    script:
      "create table t (id integer primary key, texto text);\ninsert into t values (1, 'ñandú');\n" +
      'select id from t;\nselect texto, 12.5 as importe from t;',
    scriptShortcut: 'Alt+X',
    // Sin función de espera: un conteo largo que no devuelve filas hasta terminar.
    sleep:
      'with recursive s(n) as (select 1 union all select n + 1 from s where n < 30000000) select count(*) from s',
    available: async () => null,
  },
  {
    engine: 'SQL Server',
    name: 'SQL Server Pruebas',
    async fill(dialog) {
      await dialog.getByLabel('Host').fill(env('MSSQL_HOST', '127.0.0.1')!);
      await dialog.getByLabel('Puerto').fill(env('MSSQL_PORT', '51433')!);
      await dialog.getByLabel('Base de datos (opcional)').fill(env('MSSQL_DATABASE', 'dbx_test')!);
      await dialog.getByLabel('Usuario').fill(env('MSSQL_USER', 'sa')!);
      await dialog
        .getByLabel('Contraseña', { exact: true })
        .fill(env('MSSQL_PASSWORD') ?? env('MSSQL_SA_PASSWORD')!);
      await dialog.getByRole('button', { name: 'SSL/TLS' }).click();
      await dialog.getByLabel('Cifrar').check();
      await dialog.getByLabel('Confiar en el certificado del servidor').check();
    },
    // GO separa lotes; una tabla temporal vive en la sesión de la pestaña.
    script:
      "select 1 as id into #t\ngo\nselect id from #t\ngo\nselect N'ñandú' as texto, cast(12345678901234.123456 as decimal(20,6)) as importe",
    scriptShortcut: 'Alt+X',
    sleep: "waitfor delay '00:00:30'",
    available: async () => {
      const host = env('MSSQL_HOST', '127.0.0.1')!;
      const port = Number(env('MSSQL_PORT', '51433'));
      return (await reachable(host, port)) ? null : `sin servidor en ${host}:${port}`;
    },
  },
  {
    engine: 'MariaDB / MySQL',
    name: 'MariaDB Pruebas',
    async fill(dialog) {
      await dialog.getByLabel('Host').fill(env('MARIADB_HOST', '127.0.0.1')!);
      await dialog.getByLabel('Puerto').fill(env('MARIADB_PORT', '53306')!);
      await dialog.getByLabel('Usuario').fill(env('MARIADB_USER', 'dbx')!);
      await dialog.getByLabel('Contraseña', { exact: true }).fill(env('MARIADB_PASSWORD', '')!);
    },
    // Solo lectura: nada de tablas; dos SELECT bastan.
    script:
      "select 1 as id;\nselect 'ñandú' as texto, cast(12345678901234.123456 as decimal(20,6)) as importe;",
    scriptShortcut: 'Alt+X',
    sleep: 'select sleep(30)',
    available: async () => {
      const host = env('MARIADB_HOST', '127.0.0.1')!;
      const port = Number(env('MARIADB_PORT', '53306'));
      return (await reachable(host, port)) ? null : `sin servidor en ${host}:${port}`;
    },
  },
];

for (const flow of flows) {
  test.describe(flow.engine, () => {
    test.describe.configure({ mode: 'serial' });
    let app: ElectronApplication;
    let page: Page;
    let skip: string | null = null;

    const editor = (): ReturnType<Page['locator']> => page.getByTestId('sql-editor');
    async function typeInEditor(text: string): Promise<void> {
      await editor().locator('.view-lines').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await page.keyboard.type(text);
    }

    test.beforeAll(async () => {
      skip = await flow.available();
      if (skip) return;
      app = await launchApp(tempUserData());
      page = await app.firstWindow();
      page.on('pageerror', (e) => console.log('Error en el renderer:', e.message));
      await page.getByTestId('statusbar').waitFor();
    });

    test.afterAll(async () => {
      await app?.close();
    });

    test('conecta, ejecuta un script con varios resultados y muestra la grilla', async () => {
      test.skip(!!skip, skip ?? '');
      const dialog = page.getByRole('dialog');
      await page.getByRole('button', { name: 'Nueva conexión' }).first().click();
      await dialog.getByRole('button', { name: flow.engine }).click();
      await dialog.getByLabel('Nombre', { exact: true }).fill(flow.name);
      await flow.fill(dialog);
      await dialog.getByRole('button', { name: 'Guardar' }).click();
      await page
        .locator('[data-view="connections"] .tree')
        .getByRole('treeitem', { name: new RegExp(flow.name) })
        .click();
      await page.keyboard.press('Control+N');
      await expect(editor().locator('.monaco-editor')).toBeVisible();

      await typeInEditor(flow.script);
      await page.keyboard.press(flow.scriptShortcut);
      await expect(page.getByTestId('execution-timer')).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByTestId('messages')).toHaveCount(0);
      const tabs = page.getByRole('tab', { name: /Resultado|^t$/ });
      await expect(tabs.last()).toBeVisible();
      await tabs.last().click();
      await expect(page.getByTestId('results-grid')).toHaveAttribute('data-columns', 'texto,importe');
      await expect(page.getByTestId('results-footer')).toContainText('1 fila');
      await expect(page.getByTestId('statusbar')).toContainText(flow.name);
      if (SHOTS) {
        // Árbol expandido hasta las carpetas de objetos, para revisar la distribución por motor.
        const tree = page.locator('[data-view="connections"] .tree');
        const expand = async (index: number): Promise<void> => {
          await tree.getByRole('treeitem').nth(index).locator('.tree-twistie').click();
          await page.waitForTimeout(600);
        };
        await expand(0);
        await expand(1);
        if (flow.engine === 'SQL Server') await expand(2);
        await page.screenshot({ path: join(SHOTS, `m4-${flow.engine.replace(/W+/g, '-')}.png`) });
      }
    });

    test('marca el error en su línea', async () => {
      test.skip(!!skip, skip ?? '');
      await typeInEditor('select 1,\nfrom x');
      await page.keyboard.press('Control+Enter');
      await expect(
        page.getByTestId('messages').getByRole('button', { name: 'Ir a la línea 2' }),
      ).toBeVisible();
      await expect(editor().locator('.squiggly-error')).toHaveCount(1);
    });

    test('cancela una consulta larga y la pestaña sigue usable', async () => {
      test.skip(!!skip, skip ?? '');
      await typeInEditor(flow.sleep);
      const started = Date.now();
      await page.keyboard.press('Control+Enter');
      await expect(page.getByTestId('execution-timer')).toBeVisible();
      await page.waitForTimeout(500);
      await page.keyboard.press('Control+Shift+Q');
      await expect(page.getByTestId('messages')).toContainText('cancelada', { timeout: 10_000 });
      expect(Date.now() - started).toBeLessThan(10_000);
      await typeInEditor('select 7 as siete');
      await page.keyboard.press('Control+Enter');
      await expect(page.getByTestId('results-grid')).toHaveAttribute('data-columns', 'siete');
    });
  });
}
