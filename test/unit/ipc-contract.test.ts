import { describe, expect, it } from 'vitest';
import { IPC_EVENT_CHANNELS, IPC_INVOKE_CHANNELS } from '@shared/channels';
import { ipcEventContract, ipcInvokeContract } from '@shared/ipc';

describe('contrato IPC', () => {
  it('todos los canales declarados tienen esquema', () => {
    expect(Object.keys(ipcInvokeContract).sort()).toEqual([...IPC_INVOKE_CHANNELS].sort());
    expect(Object.keys(ipcEventContract).sort()).toEqual([...IPC_EVENT_CHANNELS].sort());
  });

  it('los canales siguen el prefijo por dominio', () => {
    for (const channel of [...IPC_INVOKE_CHANNELS, ...IPC_EVENT_CHANNELS]) {
      expect(channel).toMatch(/^(conn|meta|query|data|fs|settings|app):[a-z-]+$/);
    }
  });

  it('app:ping valida el payload', () => {
    const schema = ipcInvokeContract['app:ping'].request;
    expect(schema.safeParse({ message: 'ping' }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ message: 42 }).success).toBe(false);
    expect(schema.safeParse({ message: 'x'.repeat(201) }).success).toBe(false);
  });
});
