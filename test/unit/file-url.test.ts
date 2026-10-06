import { describe, expect, it } from 'vitest';
import { isFileUrlOf } from '../../src/main/file-url';

describe('origen del renderer (IPC)', () => {
  const index =
    'C:\\Users\\JEAN~1.SAN\\AppData\\Local\\Temp\\DB Explorer\\resources\\app.asar\\out\\renderer\\index.html';

  it('acepta la URL que informa Chromium aunque Node codifique distinto el "~"', () => {
    const chromium =
      'file:///C:/Users/JEAN~1.SAN/AppData/Local/Temp/DB%20Explorer/resources/app.asar/out/renderer/index.html';
    expect(isFileUrlOf(chromium, index, 'win32')).toBe(true);
    expect(isFileUrlOf(chromium.replace('~', '%7E'), index, 'win32')).toBe(true);
    // Mayúsculas distintas en Windows, consulta y fragmento.
    expect(isFileUrlOf(`${chromium.replace('Users', 'users')}?x=1#y`, index, 'win32')).toBe(true);
  });

  it('rechaza otros archivos, otros esquemas y URL inválidas', () => {
    expect(
      isFileUrlOf('file:///C:/Users/JEAN~1.SAN/AppData/Local/Temp/otra/index.html', index, 'win32'),
    ).toBe(false);
    expect(isFileUrlOf('https://example.com/index.html', index, 'win32')).toBe(false);
    expect(isFileUrlOf('no es una url', index, 'win32')).toBe(false);
  });
});
