import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FileNode, ScriptFile, WorkspaceInfo, WorkspaceState } from '@shared/workspace';
import { copyName, invalidFileName, parseWorkspaceState } from '@shared/workspace';
import { writeFileAtomic } from './fs-atomic';

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Máximo de espacios recientes (specs/07). */
const MAX_RECENT = 10;

/** Excluidos por defecto de la vista Archivos (`files.exclude`, specs/07). */
export const DEFAULT_EXCLUDE = ['.git', 'node_modules', '.DS_Store', 'Thumbs.db'];

/** Error de escritura porque el archivo cambió en disco desde la última lectura (specs/11 §4). */
export class FileConflictError extends Error {
  constructor(readonly path: string) {
    super(`${basename(path)} cambió en disco`);
    this.name = 'FileConflictError';
  }
}

/** Ya existe un archivo o carpeta con ese nombre en el destino. */
export class FileExistsError extends Error {
  constructor(readonly path: string) {
    super(`Ya existe "${basename(path)}" en esa carpeta`);
    this.name = 'FileExistsError';
  }
}

/** Nombre de archivo o carpeta no válido (el motivo va en el mensaje). */
export class InvalidNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidNameError';
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

/** ¿`child` es `parent` o está dentro de él? (rutas ya normalizadas). */
function within(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

/**
 * Espacio de trabajo (specs/11): carpeta donde se crean los scripts, su
 * estado (pestañas) en `userData/workspaces/`, las operaciones de archivo de
 * la vista Archivos (specs/07) y la lectura y escritura de los scripts.
 */
export class WorkspaceService {
  private rootPath = '';
  private exclude = new Set(DEFAULT_EXCLUDE.map((n) => n.toLowerCase()));
  /** Archivos fuera del espacio que el usuario abrió o guardó con un diálogo nativo (specs/07). */
  private readonly allowed = new Set<string>();

  constructor(
    private readonly userData: string,
    /** `Documentos\DB Explorer` (D17). */
    private readonly defaultRoot: string,
    /** Envía a la Papelera (`shell.trashItem`); inyectado para poder probar sin Electron. */
    private readonly trashItem: (path: string) => Promise<void> = async () => {
      throw new Error('Papelera no disponible');
    },
  ) {}

  get root(): string {
    return this.rootPath;
  }

  get defaultPath(): string {
    return this.defaultRoot;
  }

  /** Nombres excluidos de la vista Archivos (`files.exclude`). */
  setExclude(names: readonly string[]): void {
    this.exclude = new Set(names.map((n) => n.toLowerCase()));
  }

  /** Excluido de la vista (incluye los temporales de la escritura atómica). */
  isExcluded(name: string): boolean {
    return this.exclude.has(name.toLowerCase()) || name.endsWith('.tmp');
  }

  /** Permite leer y escribir un archivo fuera del espacio (elegido en un diálogo nativo). */
  allow(path: string): void {
    this.allowed.add(normalize(path));
  }

  /**
   * Abre el espacio configurado o el predeterminado (creándolo si falta). Si
   * la carpeta configurada no existe, no se abre y se informa `unavailable`
   * para que el renderer ofrezca Reintentar / Elegir otra / Usar el
   * predeterminado (specs/11 §2). Con `useDefault` se abre el predeterminado
   * sin tocar la configuración.
   */
  async open(configured: string | null, options: { useDefault?: boolean } = {}): Promise<WorkspaceInfo> {
    let root = this.defaultRoot;
    if (configured && !options.useDefault) {
      if (!(await isDirectory(configured))) {
        const path = resolve(configured);
        return { path, name: basename(path), state: null, missing: [], unavailable: true };
      }
      root = resolve(configured);
    } else {
      await mkdir(root, { recursive: true });
    }
    this.rootPath = root;
    await this.addRecent(root);
    const state = await this.loadState();
    const missing: string[] = [];
    if (state) {
      const exists = await Promise.all(state.tabs.map((t) => isFile(this.resolve(t.file))));
      state.tabs = state.tabs.filter((t, i) => {
        if (!exists[i]) missing.push(t.file);
        return exists[i];
      });
      state.activeTab = Math.min(state.activeTab, state.tabs.length - 1);
      // Los archivos de fuera del espacio que siguen en pestañas se abrieron con el diálogo.
      for (const t of state.tabs) if (isAbsolute(t.file)) this.allow(t.file);
    }
    return { path: root, name: basename(root), state, missing };
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

  private recentFile(): string {
    return join(this.userData, 'workspaces', 'recientes.json');
  }

  /** Espacios usados recientemente (el último abierto primero), solo los que existen. */
  async recent(): Promise<string[]> {
    let list: string[] = [];
    try {
      const raw = JSON.parse(await readFile(this.recentFile(), 'utf8')) as unknown;
      if (Array.isArray(raw)) list = raw.filter((p): p is string => typeof p === 'string');
    } catch {
      // Todavía no hay recientes.
    }
    const exists = await Promise.all(list.map((p) => isDirectory(p)));
    return list.filter((_, i) => exists[i]);
  }

  private async addRecent(root: string): Promise<void> {
    const current = await this.recent();
    const list = [root, ...current.filter((p) => normalize(p) !== normalize(root))].slice(0, MAX_RECENT);
    await writeFileAtomic(this.recentFile(), JSON.stringify(list, null, 2)).catch(() => undefined);
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
    return within(normalize(this.rootPath), normalize(path));
  }

  /** Lectura y escritura de scripts: dentro del espacio o archivos permitidos por un diálogo. */
  private check(path: string): string {
    if (!isAbsolute(path)) throw new FileAccessError();
    if (!this.contains(path) && !this.allowed.has(normalize(path))) throw new FileAccessError();
    return resolve(path);
  }

  /**
   * Ruta dentro del espacio para las operaciones del árbol: la ruta escrita y
   * la real (`realpath`, que sigue enlaces) deben quedar dentro (specs/07).
   */
  private async guard(path: string): Promise<string> {
    if (!isAbsolute(path) || !this.contains(path)) throw new FileAccessError();
    const target = resolve(path);
    const real = await realpath(target).catch(() => null);
    if (real) {
      const root = await realpath(this.rootPath).catch(() => this.rootPath);
      if (!within(normalize(root), normalize(real))) throw new FileAccessError();
    }
    return target;
  }

  private isRoot(path: string): boolean {
    return normalize(path) === normalize(this.rootPath);
  }

  private validName(name: string): string {
    const reason = invalidFileName(name);
    if (reason) throw new InvalidNameError(reason);
    return name;
  }

  /** Entradas de una carpeta del espacio (carpetas primero, sin las excluidas). */
  async listDir(dir: string): Promise<FileNode[]> {
    const target = await this.guard(dir);
    const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
    const entries = await readdir(target, { withFileTypes: true });
    const nodes: FileNode[] = entries
      .filter((e) => (e.isDirectory() || e.isFile()) && !this.isExcluded(e.name))
      .map((e) => ({ name: e.name, path: join(target, e.name), dir: e.isDirectory() }));
    return nodes.sort((a, b) => (a.dir === b.dir ? collator.compare(a.name, b.name) : a.dir ? -1 : 1));
  }

  /** Crea un archivo vacío o una carpeta. */
  async create(dir: string, name: string, kind: 'file' | 'folder'): Promise<string> {
    const target = await this.guard(join(await this.guard(dir), this.validName(name)));
    if (await exists(target)) throw new FileExistsError(target);
    if (kind === 'folder') await mkdir(target);
    else await writeFile(target, '', { flag: 'wx' });
    return target;
  }

  /** Renombra en la misma carpeta (se admite cambiar solo mayúsculas). */
  async rename(path: string, name: string): Promise<string> {
    const source = await this.guard(path);
    if (this.isRoot(source)) throw new FileAccessError('No se puede renombrar el espacio de trabajo');
    const target = join(dirname(source), this.validName(name));
    if (target === source) return source;
    if (normalize(target) !== normalize(source) && (await exists(target))) throw new FileExistsError(target);
    await rename(source, target);
    return target;
  }

  /** Mueve archivos o carpetas a otra carpeta del espacio. */
  async move(paths: readonly string[], targetDir: string): Promise<{ from: string; to: string }[]> {
    const dir = await this.guard(targetDir);
    const moved: { from: string; to: string }[] = [];
    for (const path of paths) {
      const source = await this.guard(path);
      if (this.isRoot(source)) throw new FileAccessError('No se puede mover el espacio de trabajo');
      const target = join(dir, basename(source));
      if (normalize(target) === normalize(source)) continue;
      if (within(normalize(source), normalize(dir))) {
        throw new FileAccessError('No se puede mover una carpeta dentro de sí misma');
      }
      if (await exists(target)) throw new FileExistsError(target);
      await rename(source, target);
      moved.push({ from: source, to: target });
    }
    return moved;
  }

  /** Copia a una carpeta; si el nombre ya existe agrega " copia" (specs/07). */
  async copy(paths: readonly string[], targetDir: string): Promise<string[]> {
    const dir = await this.guard(targetDir);
    const names = new Set((await readdir(dir)).map((n) => n.toLowerCase()));
    const created: string[] = [];
    for (const path of paths) {
      const source = await this.guard(path);
      if (within(normalize(source), normalize(dir)) && (await isDirectory(source))) {
        throw new FileAccessError('No se puede copiar una carpeta dentro de sí misma');
      }
      const name = copyName(basename(source), (n) => names.has(n.toLowerCase()));
      names.add(name.toLowerCase());
      const target = join(dir, name);
      await cp(source, target, { recursive: true, errorOnExist: true, force: false });
      created.push(target);
    }
    return created;
  }

  /** Envía a la Papelera; nunca se borra de forma permanente (specs/07). */
  async trash(paths: readonly string[]): Promise<void> {
    for (const path of paths) {
      const target = await this.guard(path);
      if (this.isRoot(target)) throw new FileAccessError('No se puede eliminar el espacio de trabajo');
      await this.trashItem(target);
    }
  }

  /** Ruta validada dentro del espacio (mostrar en el Explorador, abrir con el sistema). */
  inside(path: string): Promise<string> {
    return this.guard(path);
  }

  /**
   * Árbol completo del espacio (carpetas primero), para la búsqueda de
   * archivos de Ctrl+P. Se limita el total para no frenar con carpetas enormes.
   */
  async listFiles(maxEntries = 5000, maxDepth = 8): Promise<FileNode[]> {
    let count = 0;
    const walk = async (dir: string, depth: number): Promise<FileNode[]> => {
      const nodes = await this.listDir(dir).catch(() => []);
      const kept = nodes.slice(0, Math.max(0, maxEntries - count));
      count += kept.length;
      for (const node of kept) {
        if (node.dir) node.children = depth < maxDepth ? await walk(node.path, depth + 1) : [];
      }
      return kept;
    };
    return walk(this.rootPath, 0);
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
      if (current && Math.abs(current.mtimeMs - options.expectedMtimeMs) > 1)
        throw new FileConflictError(target);
    }
    const body = Buffer.from(content, 'utf8');
    await writeFileAtomic(target, options.bom ? Buffer.concat([BOM, body]) : body);
    return { mtimeMs: (await stat(target)).mtimeMs };
  }

  /** Elimina un script solo si en disco está vacío (o solo tiene espacios). */
  async deleteIfEmpty(path: string): Promise<boolean> {
    const target = this.check(path);
    const data = await readFile(target, 'utf8').catch(() => null);
    if (data === null || data.replace(/^\uFEFF/, '').trim() !== '') return false;
    await unlink(target);
    return true;
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
