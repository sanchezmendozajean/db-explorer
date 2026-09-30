import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ScriptFile, WorkspaceInfo, WorkspaceState } from '@shared/workspace';
import { parseWorkspaceState } from '@shared/workspace';
import { writeFileAtomic } from './fs-atomic';

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Error de escritura porque el archivo cambió en disco desde la última lectura (specs/11 §4). */
export class FileConflictError extends Error {
  constructor(readonly path: string) {
    super(`${basename(path)} cambió en disco`);
    this.name = 'FileConflictError';
  }
}

export class FileAccessError extends Error {
  constructor(message = 'La ruta está fuera del espacio de trabajo') {
    super(message);
    this.name = 'FileAccessError';
  }
}

/** Clave estable de una ruta (Windows no distingue mayúsculas). */
function normalize(path: string): string {
  const abs = resolve(path);
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

/**
 * Espacio de trabajo (specs/11): carpeta donde se crean los scripts, su
 * estado (pestañas) en `userData/workspaces/` y las operaciones de archivo
 * de los scripts abiertos.
 */
export class WorkspaceService {
  private rootPath = '';

  constructor(
    private readonly userData: string,
    /** `Documentos\DB Explorer` (D17). */
    private readonly defaultRoot: string,
  ) {}

  get root(): string {
    return this.rootPath;
  }

  /**
   * Abre el espacio configurado o el predeterminado (creándolo si falta).
   * Si la carpeta configurada no existe se usa la predeterminada; el modal
   * "espacio no disponible" de specs/11 §2 llega en M5.
   */
  async open(configured: string | null): Promise<WorkspaceInfo> {
    let root = this.defaultRoot;
    if (configured && (await isDirectory(configured))) root = resolve(configured);
    else await mkdir(root, { recursive: true });
    this.rootPath = root;
    return { path: root, name: basename(root), state: await this.loadState() };
  }

  private stateFile(): string {
    const hash = createHash('sha1').update(normalize(this.rootPath)).digest('hex');
    return join(this.userData, 'workspaces', `${hash}.json`);
  }

  private async loadState(): Promise<WorkspaceState | null> {
    try {
      return parseWorkspaceState(JSON.parse(await readFile(this.stateFile(), 'utf8')));
    } catch {
      return null;
    }
  }

  async saveState(state: WorkspaceState): Promise<void> {
    await writeFileAtomic(this.stateFile(), JSON.stringify({ ...state, path: this.rootPath }, null, 2));
  }

  /** Ruta absoluta de un archivo del estado (relativo al espacio o absoluto). */
  resolve(file: string): string {
    return isAbsolute(file) ? resolve(file) : resolve(this.rootPath, file);
  }

  /** Ruta para guardar en el estado: relativa si está dentro del espacio. */
  toStatePath(path: string): string {
    return this.contains(path) ? relative(this.rootPath, path) : path;
  }

  contains(path: string): boolean {
    const root = normalize(this.rootPath);
    const target = normalize(path);
    return target === root || target.startsWith(root.endsWith(sep) ? root : root + sep);
  }

  private check(path: string): string {
    if (!isAbsolute(path) || !this.contains(path)) throw new FileAccessError();
    return resolve(path);
  }

  /** Crea `Script-N.sql` con el menor N ≥ 1 libre en la raíz (D16). */
  async newScript(): Promise<string> {
    for (let n = 1; n < 100_000; n++) {
      const path = join(this.rootPath, `Script-${n}.sql`);
      try {
        await writeFile(path, '', { flag: 'wx' });
        return path;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
    }
    throw new Error('No se pudo crear un nombre de script libre');
  }

  async readScript(path: string): Promise<ScriptFile> {
    const target = this.check(path);
    const [data, info] = await Promise.all([readFile(target), stat(target)]);
    const bom = data.subarray(0, 3).equals(BOM);
    const content = (bom ? data.subarray(3) : data).toString('utf8');
    return { content, mtimeMs: info.mtimeMs, bom, eol: content.includes('\r\n') ? 'CRLF' : 'LF' };
  }

  /**
   * Guarda de forma atómica conservando el BOM. Si el archivo cambió en disco
   * desde `expectedMtimeMs`, no lo sobrescribe (salvo `force`).
   */
  async writeScript(
    path: string,
    content: string,
    options: { bom: boolean; expectedMtimeMs?: number; force?: boolean },
  ): Promise<{ mtimeMs: number }> {
    const target = this.check(path);
    if (!options.force && options.expectedMtimeMs !== undefined) {
      const current = await stat(target).catch(() => null);
      if (current && Math.abs(current.mtimeMs - options.expectedMtimeMs) > 1) throw new FileConflictError(target);
    }
    const body = Buffer.from(content, 'utf8');
    await writeFileAtomic(target, options.bom ? Buffer.concat([BOM, body]) : body);
    return { mtimeMs: (await stat(target)).mtimeMs };
  }

  /** Elimina un script solo si en disco está vacío (o solo tiene espacios). */
  async deleteIfEmpty(path: string): Promise<boolean> {
    const target = this.check(path);
    const data = await readFile(target, 'utf8').catch(() => null);
    if (data === null || data.replace(/^﻿/, '').trim() !== '') return false;
    await unlink(target);
    return true;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
