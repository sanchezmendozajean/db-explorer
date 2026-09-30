import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { resolve } from 'node:path';

let app: ElectronApplication;

test.beforeAll(async () => {
  // Terminales integradas de VS Code heredan ELECTRON_RUN_AS_NODE=1, que haría arrancar Electron como Node.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[0] !== 'ELECTRON_RUN_AS_NODE' && entry[1] !== undefined,
    ),
  );
  app = await electron.launch({ args: [resolve(__dirname, '../../out/main/index.js')], env });
});

test.afterAll(async () => {
  await app.close();
});

test('el renderer muestra la respuesta del ping al db-host', async () => {
  const page = await app.firstWindow();
  await expect(page.getByTestId('ping-status')).toHaveText('El db-host respondió');
  await expect(page.getByTestId('ping-echo')).toHaveText('ping');
});

test('el renderer no tiene acceso a Node', async () => {
  const page = await app.firstWindow();
  const globals = await page.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>)['require'],
    process: typeof (globalThis as Record<string, unknown>)['process'],
    api: typeof (globalThis as Record<string, unknown>)['api'],
  }));
  expect(globals).toEqual({ require: 'undefined', process: 'undefined', api: 'object' });
});

test('se bloquea window.open y la navegación externa', async () => {
  const page = await app.firstWindow();
  const opened = await page.evaluate(() => window.open('https://example.com') === null);
  expect(opened).toBe(true);
  const urlBefore = page.url();
  await page.evaluate(() => {
    window.location.href = 'https://example.com';
  });
  await page.waitForTimeout(300);
  expect(page.url()).toBe(urlBefore);
  expect(app.windows()).toHaveLength(1);
});

test('la CSP está presente y bloquea scripts inline', async () => {
  const page = await app.firstWindow();
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  const scriptSrc = csp?.split(';').find((d) => d.trim().startsWith('script-src'));
  expect(scriptSrc?.trim()).toBe("script-src 'self'");
  const executed = await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__inline = true;';
    document.body.appendChild(s);
    return (window as unknown as Record<string, unknown>)['__inline'] === true;
  });
  expect(executed).toBe(false);
});
