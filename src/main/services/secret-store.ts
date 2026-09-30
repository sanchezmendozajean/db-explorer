import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { writeFileAtomic } from './fs-atomic';

/** Cifrado de cadenas (en la app, `safeStorage` de Electron = DPAPI del usuario en Windows). */
export interface Encryptor {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(data: Buffer): string;
}

const SecretsFileSchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), z.string()),
});

/**
 * `secrets.bin` (specs/08): contraseñas cifradas indexadas por id de conexión.
 * El texto plano solo existe en memoria el tiempo justo para pasarlo al db-host.
 */
export class SecretStore {
  private entries: Record<string, string> = {};

  constructor(
    private readonly file: string,
    private readonly encryptor: Encryptor,
  ) {}

  get available(): boolean {
    return this.encryptor.isAvailable();
  }

  async load(): Promise<void> {
    try {
      const parsed = SecretsFileSchema.safeParse(JSON.parse(await readFile(this.file, 'utf8')));
      this.entries = parsed.success ? parsed.data.entries : {};
    } catch {
      this.entries = {};
    }
  }

  /** Ids de conexiones con contraseña guardada (lo único que ve el renderer). */
  ids(): string[] {
    return Object.keys(this.entries);
  }

  has(id: string): boolean {
    return id in this.entries;
  }

  get(id: string): string | undefined {
    const blob = this.entries[id];
    if (!blob || !this.available) return undefined;
    try {
      return this.encryptor.decrypt(Buffer.from(blob, 'base64'));
    } catch {
      return undefined;
    }
  }

  async set(id: string, password: string): Promise<void> {
    if (!this.available) throw new Error('El cifrado del sistema no está disponible');
    this.entries = { ...this.entries, [id]: this.encryptor.encrypt(password).toString('base64') };
    await this.write();
  }

  async copy(fromId: string, toId: string): Promise<void> {
    const blob = this.entries[fromId];
    if (!blob) return;
    this.entries = { ...this.entries, [toId]: blob };
    await this.write();
  }

  async delete(id: string): Promise<void> {
    if (!(id in this.entries)) return;
    this.entries = Object.fromEntries(Object.entries(this.entries).filter(([key]) => key !== id));
    await this.write();
  }

  /** "Olvidar contraseñas guardadas" (Preferencias, M8). */
  async clear(): Promise<void> {
    this.entries = {};
    await this.write();
  }

  private async write(): Promise<void> {
    await writeFileAtomic(this.file, JSON.stringify({ version: 1, entries: this.entries }));
  }
}
