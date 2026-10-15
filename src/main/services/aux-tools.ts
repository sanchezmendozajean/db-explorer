import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { ToolFamily, ToolFamilyStatus, ToolImportResult } from '@shared/db-admin';
import { parseToolVersion, toolFileNames } from '@shared/db-admin';
import { isElf, isPortableExecutable, resolveDependencies } from './pe-imports';

interface Manifest {
  files: Record<string, { version: string; banner: string; libs: string[]; missing: string[] }>;
}

/** DLL que provee Windows: las de API-sets y las que están en System32. */
function isSystemDll(dll: string): boolean {
  const lower = dll.toLowerCase();
  if (lower.startsWith('api-ms-') || lower.startsWith('ext-ms-')) return true;
  return existsSync(join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', dll));
}

/** Tiempo máximo para que un binario responda a `--version`. */
const VERSION_TIMEOUT_MS = 5000;

/** Códigos de salida de Windows cuando falta una DLL (`STATUS_DLL_NOT_FOUND`, `STATUS_ENTRYPOINT_NOT_FOUND`). */
const MISSING_LIBRARY_CODES = new Set([0xc0000135, 0xc0000139, 3221225781, 3221225785]);

/** Primeros bytes de un archivo (para reconocer su formato sin leerlo entero). */
async function readHead(path: string, bytes: number): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Herramientas auxiliares de respaldo (pg_dump, mysqldump…) que aporta el usuario. Se copian a una
 * carpeta propia del programa (`<userData>/tools/<familia>/`) y desde ahí se ejecutan; así no
 * dependen del lugar de origen y cada familia (PostgreSQL, MariaDB, MySQL) lleva sus binarios.
 */
export class AuxTools {
  constructor(
    private readonly root: string,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  /** Carpeta que contiene la de cada familia: se puede respaldar y volver a copiar tal cual. */
  get rootDir(): string {
    return this.root;
  }

  dir(family: ToolFamily): string {
    return join(this.root, family);
  }

  /** Última carpeta de la que se importaron archivos de la familia (para abrir el selector ahí). */
  async lastSourceDir(family: ToolFamily): Promise<string | undefined> {
    const dir = (await this.readSources())[family];
    const exists = dir
      ? await stat(dir)
          .then((s) => s.isDirectory())
          .catch(() => false)
      : false;
    return exists ? dir : undefined;
  }

  private async readSources(): Promise<Partial<Record<ToolFamily, string>>> {
    try {
      return JSON.parse(await readFile(join(this.root, 'sources.json'), 'utf8')) as Partial<
        Record<ToolFamily, string>
      >;
    } catch {
      return {};
    }
  }

  /** Ruta de un binario importado; `null` si no está. */
  async pathOf(family: ToolFamily, name: string): Promise<string | null> {
    const path = join(this.dir(family), name);
    return (await stat(path)
      .then((s) => s.isFile())
      .catch(() => false))
      ? path
      : null;
  }

  async status(family: ToolFamily): Promise<ToolFamilyStatus> {
    const manifest = await this.readManifest(family);
    await this.adoptRestored(family, manifest);
    const files = await Promise.all(
      toolFileNames(family, this.platform).map(async (name) => {
        const installed = (await this.pathOf(family, name)) !== null;
        const info = manifest.files[name];
        const names = [...new Set([...(info?.libs ?? []), ...(info?.missing ?? [])])];
        const libraries = names.map((lib) => ({
          name: lib,
          installed: existsSync(join(this.dir(family), lib)),
        }));
        return {
          name,
          installed,
          version: installed ? info?.version : undefined,
          banner: installed ? info?.banner : undefined,
          libraries: libraries.length > 0 ? libraries : undefined,
        };
      }),
    );
    return { family, files };
  }

  /**
   * Binarios que están en la carpeta pero no en el manifiesto (p. ej. se copió de vuelta una copia de
   * seguridad de `tools/` sin ese archivo): se les lee la versión y las bibliotecas que tienen al lado.
   */
  private async adoptRestored(family: ToolFamily, manifest: Manifest): Promise<void> {
    let changed = false;
    for (const name of toolFileNames(family, this.platform)) {
      const exe = await this.pathOf(family, name);
      if (!exe || manifest.files[name]?.version) continue;
      const probe = await this.probeVersion(family, exe);
      if (!('version' in probe)) continue;
      const libs =
        this.platform === 'win32'
          ? (await resolveDependencies(exe, isSystemDll)).found.map((d) => basename(d))
          : [];
      manifest.files[name] = { version: probe.version, banner: probe.banner, libs, missing: [] };
      changed = true;
    }
    if (changed) await this.writeManifest(family, manifest);
  }

  async remove(family: ToolFamily): Promise<ToolFamilyStatus> {
    // En Windows el antivirus o el propio proceso recién terminado pueden retener un ejecutable unos instantes.
    await rm(this.dir(family), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    return this.status(family);
  }

  /**
   * Copia los archivos elegidos a la carpeta interna, comprueba que sean ejecutables de la
   * herramienta esperada y lee su versión. Lo que no pasa la comprobación se descarta y se informa.
   */
  async import(family: ToolFamily, paths: string[]): Promise<ToolImportResult> {
    const expected = toolFileNames(family, this.platform);
    const rejected: ToolImportResult['rejected'] = [];
    const manifest = await this.readManifest(family);
    const target = this.dir(family);
    await mkdir(target, { recursive: true });

    const chosen = new Map<string, string>();
    for (const path of paths) {
      const name = expected.find((e) => this.sameName(e, basename(path)));
      if (!name) {
        rejected.push({ path, reason: `No es uno de los archivos esperados (${expected.join(', ')})` });
      } else {
        chosen.set(name, path);
      }
    }

    for (const [name, source] of chosen) {
      const reason = await this.importOne(family, name, source, target, manifest);
      if (reason) rejected.push({ path: source, reason });
    }
    await this.writeManifest(family, manifest);
    const first = [...chosen.values()][0];
    if (first) {
      const sources = await this.readSources();
      sources[family] = dirname(first);
      await writeFile(join(this.root, 'sources.json'), JSON.stringify(sources), 'utf8');
    }
    return { status: await this.status(family), rejected };
  }

  private async importOne(
    family: ToolFamily,
    name: string,
    source: string,
    target: string,
    manifest: Manifest,
  ): Promise<string | null> {
    const head = await readHead(source, 4096).catch(() => null);
    if (!head) return 'No se pudo leer el archivo';
    const valid = this.platform === 'win32' ? isPortableExecutable(head) : isElf(head);
    if (!valid) return 'No es un ejecutable válido para este sistema';

    const destination = join(target, name);
    let libs: string[] = [];
    let missing: string[] = [];
    try {
      if (this.platform === 'win32') {
        // Las bibliotecas que el programa necesita y están junto a él (libpq.dll, libssl…).
        const deps = await resolveDependencies(source, isSystemDll);
        for (const dependency of deps.found) {
          await this.copyReplacing(dependency, join(target, basename(dependency)));
        }
        libs = deps.found.map((d) => basename(d));
        missing = deps.missing;
      }
      await this.copyReplacing(source, destination);
      if (this.platform !== 'win32') await chmod(destination, 0o755);
    } catch (err) {
      return `No se pudo copiar: ${err instanceof Error ? err.message : String(err)}`;
    }

    const probe = await this.probeVersion(family, destination);
    if (!('version' in probe)) {
      await rm(destination, { force: true });
      // Se recuerdan las bibliotecas para que la lista muestre cuáles faltan.
      manifest.files[name] = { version: '', banner: '', libs, missing };
      return missing.length > 0 ? `${probe.reason} Faltan: ${missing.join(', ')}.` : probe.reason;
    }
    // Si arrancó, el cargador resolvió todo: lo que no se halló junto al archivo lo provee el sistema.
    manifest.files[name] = { version: probe.version, banner: probe.banner, libs, missing: [] };
    return null;
  }

  /** Ejecuta `--version` y verifica que la salida corresponda a la familia. */
  private probeVersion(
    family: ToolFamily,
    exe: string,
  ): Promise<{ version: string; banner: string } | { reason: string }> {
    return new Promise((resolve) => {
      execFile(
        exe,
        ['--version'],
        { timeout: VERSION_TIMEOUT_MS, windowsHide: true, cwd: this.dir(family) },
        (err, stdout, stderr) => {
          const output = `${stdout}\n${stderr}`;
          const parsed = err && !output.trim() ? null : parseToolVersion(family, output);
          if (parsed) {
            resolve(parsed);
            return;
          }
          const code = (err as (NodeJS.ErrnoException & { code?: string | number }) | null)?.code;
          if (typeof code === 'number' && MISSING_LIBRARY_CODES.has(code >>> 0)) {
            resolve({
              reason:
                'Faltan bibliotecas (.dll) que el programa necesita. Selecciona el archivo desde la carpeta bin de la instalación, donde están junto a él.',
            });
          } else if (err && !output.trim()) {
            resolve({ reason: 'No se pudo ejecutar para leer su versión' });
          } else {
            const line =
              output
                .split(/\r?\n/)
                .find((l) => l.trim())
                ?.trim() ?? '';
            resolve({
              reason: `No parece ser la herramienta esperada${line ? ` (dice: ${line.slice(0, 120)})` : ''}`,
            });
          }
        },
      );
    });
  }

  private sameName(a: string, b: string): boolean {
    return this.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  }

  /** Copia por un nombre temporal y renombra, para no dejar un archivo a medias si falla. */
  private async copyReplacing(from: string, to: string): Promise<void> {
    const temp = `${to}.tmp-${process.pid}`;
    await copyFile(from, temp);
    try {
      await rename(temp, to);
    } catch (err) {
      await rm(temp, { force: true });
      throw err;
    }
  }

  private async readManifest(family: ToolFamily): Promise<Manifest> {
    try {
      const parsed = JSON.parse(await readFile(join(this.dir(family), 'manifest.json'), 'utf8')) as Manifest;
      return parsed && typeof parsed.files === 'object' && parsed.files ? parsed : { files: {} };
    } catch {
      return { files: {} };
    }
  }

  private async writeManifest(family: ToolFamily, manifest: Manifest): Promise<void> {
    await writeFile(join(this.dir(family), 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  }
}
