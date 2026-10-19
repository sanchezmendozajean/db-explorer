import { expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchApp, tempUserData } from './helpers';

/**
 * Actualización automática con el servicio simulado (`DBX_UPDATE_FAKE`): sin red ni instalador se
 * comprueba el punto del engranaje y las opciones de su menú.
 */

let app: ElectronApplication | undefined;

test.afterEach(async () => {
  await app?.close();
  delete process.env['DBX_UPDATE_FAKE'];
});

async function open(fake: 'ready' | 'none'): Promise<Page> {
  process.env['DBX_UPDATE_FAKE'] = fake;
  app = await launchApp(tempUserData());
  const page = await app.firstWindow();
  await page.getByTestId('statusbar').waitFor();
  return page;
}

const gear = (page: Page): ReturnType<Page['locator']> => page.getByRole('button', { name: /^Administrar/ });
const menuItem = (page: Page, name: string): ReturnType<Page['locator']> =>
  page.getByRole('menuitem', { name });

test('con una versión descargada el engranaje tiene punto y ofrece reiniciar', async () => {
  const page = await open('ready');
  // La búsqueda automática arranca a los 5 s y la descarga simulada tarda ~3 s más.
  await expect(page.getByTestId('update-badge')).toBeVisible({ timeout: 20_000 });
  await gear(page).click();
  await expect(menuItem(page, 'Reiniciar para instalar nueva versión')).toBeVisible();
  await expect(menuItem(page, 'Buscar actualización')).toHaveCount(0);
});

test('sin versión nueva "Buscar actualización" avisa y no hay punto', async () => {
  const page = await open('none');
  await gear(page).click();
  await expect(menuItem(page, 'Reiniciar para instalar nueva versión')).toHaveCount(0);
  await menuItem(page, 'Buscar actualización').click();
  await expect(page.getByText('Ya tienes la última versión.')).toBeVisible();
  await expect(page.getByTestId('update-badge')).toHaveCount(0);
});
