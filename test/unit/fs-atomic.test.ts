import { describe, expect, it } from 'vitest';
import { renameWithRetry } from '../../src/main/services/fs-atomic';

const fsError = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

describe('renameWithRetry', () => {
  it('reintenta mientras Windows tiene el destino bloqueado (EPERM/EBUSY)', async () => {
    let calls = 0;
    await renameWithRetry('a', 'b', async () => {
      calls++;
      if (calls < 3) throw fsError(calls === 1 ? 'EPERM' : 'EBUSY');
    });
    expect(calls).toBe(3);
  });

  it('no reintenta otros errores', async () => {
    let calls = 0;
    await expect(
      renameWithRetry('a', 'b', async () => {
        calls++;
        throw fsError('ENOENT');
      }),
    ).rejects.toThrow('ENOENT');
    expect(calls).toBe(1);
  });

  it('se rinde tras los reintentos', async () => {
    let calls = 0;
    await expect(
      renameWithRetry('a', 'b', async () => {
        calls++;
        throw fsError('EPERM');
      }),
    ).rejects.toThrow('EPERM');
    expect(calls).toBe(9);
  });
});
