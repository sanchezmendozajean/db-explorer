import { expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { launchApp } from './helpers';

let app: ElectronApplication;

test.beforeAll(async () => {
  app = await launchApp();
});

test.afterAll(async () => {
  await app.close();
});

test('"Acerca de" muestra la respuesta del ping al db-host', async () => {
  const page = await app.firstWindow();
  await page.getByRole('menuitem', { name: 'Ayuda' }).click();
  await page.getByRole('menuitem', { name: 'Acerca de' }).click();
  await expect(page.getByTestId('ping-status')).toHaveText(/^Responde \(PID \d+/);
  await page.keyboard.press('Escape');
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

test('no se cargan recursos remotos (fuentes, estilos, scripts)', async () => {
  const page = await app.firstWindow();
  const remote = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((url) => !url.startsWith('file:') && !url.startsWith('data:')),
  );
  expect(remote).toEqual([]);
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      cascadia: document.fonts.check('13px "Cascadia Code"'),
      codicon: document.fonts.check('16px codicon'),
    };
  });
  expect(fonts).toEqual({ cascadia: true, codicon: true });
});
