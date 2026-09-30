import { copyFile, readFile, rename } from 'node:fs/promises';
import type { ConnectionConfig, ConnectionsState } from '@shared/connection';
import { ConnectionConfigSchema, ConnectionsFileSchema } from '@shared/connection';
import { writeFileAtomic } from './fs-atomic';

export interface LoadResult extends ConnectionsState {
  /** Cantidad de entradas omitidas por ser inválidas. */
  skipped: number;
}

/**
 * `connections.json` (specs/08): validado con zod al leer (las entradas
 * inválidas se omiten con aviso), copia `.bak` antes de cada escritura y
 * escritura atómica. Nunca contiene contraseñas.
 */
export class ConnectionStore {
  private state: ConnectionsState = { folders: [], connections: [] };

  constructor(private readonly file: string) {}

  get current(): ConnectionsState {
    return this.state;
  }

  get(id: string): ConnectionConfig | undefined {
    return this.state.connections.find((c) => c.id === id);
  }

  async load(): Promise<LoadResult> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch {
      this.state = { folders: [], connections: [] };
      return { ...this.state, skipped: 0 };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Archivo ilegible: se aparta (no se pierde) y se empieza vacío.
      await rename(this.file, `${this.file}.invalido-${Date.now()}`).catch(() => undefined);
      this.state = { folders: [], connections: [] };
      return { ...this.state, skipped: 1 };
    }

    const file = ConnectionsFileSchema.safeParse(parsed);
    if (!file.success) {
      await rename(this.file, `${this.file}.invalido-${Date.now()}`).catch(() => undefined);
      this.state = { folders: [], connections: [] };
      return { ...this.state, skipped: 1 };
    }

    const connections: ConnectionConfig[] = [];
    let skipped = 0;
    const ids = new Set<string>();
    for (const raw of file.data.connections) {
      const result = ConnectionConfigSchema.safeParse(raw);
      if (result.success && !ids.has(result.data.id)) {
        ids.add(result.data.id);
        connections.push(result.data);
      } else {
        skipped++;
      }
    }
    const folders = [...new Set(file.data.folders)];
    for (const c of connections) if (c.folder && !folders.includes(c.folder)) folders.push(c.folder);
    this.state = { folders, connections };
    return { ...this.state, skipped };
  }

  async upsert(config: ConnectionConfig): Promise<void> {
    const connections = [...this.state.connections];
    const index = connections.findIndex((c) => c.id === config.id);
    if (index >= 0) connections[index] = config;
    else connections.push(config);
    const folders = [...this.state.folders];
    if (config.folder && !folders.includes(config.folder)) folders.push(config.folder);
    await this.write({ folders, connections });
  }

  async remove(id: string): Promise<void> {
    await this.write({ ...this.state, connections: this.state.connections.filter((c) => c.id !== id) });
  }

  /**
   * Reordena conexiones y carpetas. `order` debe contener exactamente los ids
   * existentes; cada conexión puede cambiar de carpeta.
   */
  async setLayout(folders: string[], order: { id: string; folder?: string }[]): Promise<void> {
    const byId = new Map(this.state.connections.map((c) => [c.id, c]));
    if (order.length !== byId.size || order.some((o) => !byId.has(o.id))) {
      throw new Error('El orden no coincide con las conexiones existentes');
    }
    const uniqueFolders = [...new Set(folders)];
    const connections = order.map(({ id, folder }) => {
      const c = byId.get(id)!;
      const next: ConnectionConfig = {
        ...c,
        folder: folder && uniqueFolders.includes(folder) ? folder : undefined,
      };
      if (next.folder === undefined) delete next.folder;
      return next;
    });
    await this.write({ folders: uniqueFolders, connections });
  }

  private async write(state: ConnectionsState): Promise<void> {
    await copyFile(this.file, `${this.file}.bak`).catch(() => undefined);
    const body = { version: 1 as const, folders: state.folders, connections: state.connections };
    await writeFileAtomic(this.file, JSON.stringify(body, null, 2));
    this.state = state;
  }
}
