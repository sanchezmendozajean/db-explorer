/**
 * Genera `resources/icon.ico` y `resources/icon.png` a partir de
 * `resources/icon.svg`, rasterizando con Electron (sin dependencias extra).
 * Uso: `npm run icon` (corre con el binario de Electron del proyecto).
 *
 * Cada tamaño se dibuja por separado para que los chicos queden nítidos; el
 * .ico guarda cada imagen como PNG (formato admitido desde Windows Vista).
 */
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources');
const svg = readFileSync(join(root, 'icon.svg'), 'utf8');

/** Dibuja todos los tamaños en una página y captura cada uno por separado. */
async function renderAll(sizes) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  // El de 512 arriba a la izquierda; los demás en una fila debajo.
  let x = 0;
  const boxes = sizes.map((size) => {
    const box = size === 512 ? { x: 0, y: 0, size } : { x, y: 520, size };
    if (size !== 512) x += size + 4;
    return box;
  });
  const imgs = boxes
    .map(
      (b) =>
        `<img src="${src}" width="${b.size}" height="${b.size}" style="position:absolute;left:${b.x}px;top:${b.y}px">`,
    )
    .join('');
  await win.loadURL(
    `data:text/html;base64,${Buffer.from(`<html><body style="margin:0;background:transparent">${imgs}</body></html>`).toString('base64')}`,
  );
  await new Promise((r) => setTimeout(r, 300));
  const out = new Map();
  for (const b of boxes) {
    const image = await win.webContents.capturePage({ x: b.x, y: b.y, width: b.size, height: b.size });
    // Con escalado de pantalla la captura trae más píxeles: se ajusta al tamaño pedido.
    const sized =
      image.getSize().width === b.size
        ? image
        : image.resize({ width: b.size, height: b.size, quality: 'best' });
    out.set(b.size, sized.toPNG());
  }
  win.destroy();
  return out;
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const pngs = await renderAll([...SIZES, 512]);
  writeFileSync(join(root, 'icon.ico'), ico(SIZES.map((size) => ({ size, png: pngs.get(size) }))));
  writeFileSync(join(root, 'icon.png'), pngs.get(512));
  console.log(`icon.ico (${SIZES.join(', ')} px) e icon.png (512 px) generados en resources/`);
  app.quit();
});
