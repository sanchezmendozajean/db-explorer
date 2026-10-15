import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnectionConfig } from '@shared/connection';
import type { ToolFamily } from '@shared/db-admin';
import { toolFileNames } from '@shared/db-admin';
import type { AuxTools } from './aux-tools';

export type BackupKind = 'backup' | 'restore';

/** Opciones de `pg_restore` que el usuario puede quitar; por defecto se aplican las dos. */
export interface RestoreOptions {
  /** `--no-owner`: los objetos quedan a nombre del usuario que conecta. */
  noOwner: boolean;
  /** `--no-privileges`: no se aplican los GRANT/REVOKE del respaldo. */
  noPrivileges: boolean;
}

export interface BackupJob {
  family: ToolFamily;
  kind: BackupKind;
  config: ConnectionConfig;
  secret: string | undefined;
  database: string;
  /** Solo PostgreSQL al restaurar. */
  options?: RestoreOptions;
  /** Archivo de respaldo (de salida al respaldar, de entrada al restaurar). */
  file: string;
}

/** Cómo se lanza una herramienta: argumentos, entorno y, si hay, archivo que se envía por la entrada estándar. */
export interface Invocation {
  args: string[];
  env: Record<string, string>;
  stdinFile?: string;
  /** Usa un archivo `--defaults-extra-file` (MariaDB/MySQL): lleva la contraseña fuera de la línea de comandos. */
  usesDefaultsFile?: boolean;
}

/** Valor entre comillas dobles para un archivo de opciones de MySQL/MariaDB. */
function optionValue(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
  return `"${escaped}"`;
}

/** Archivo de opciones `[client]` con la contraseña y el modo de TLS (los clientes de MySQL y MariaDB lo nombran distinto). */
export function buildDefaultsFile(
  family: ToolFamily,
  config: ConnectionConfig,
  secret: string | undefined,
): string {
  const lines = ['[client]'];
  if (secret) lines.push(`password=${optionValue(secret)}`);
  const mode = config.ssl?.mode ?? 'disable';
  const ca = config.ssl?.caFile ? optionValue(config.ssl.caFile) : undefined;
  if (family === 'mysql') {
    const modes = {
      disable: 'DISABLED',
      require: 'REQUIRED',
      'verify-ca': 'VERIFY_CA',
      'verify-full': 'VERIFY_IDENTITY',
    };
    lines.push(`ssl-mode=${modes[mode]}`);
    if (ca && mode !== 'disable') lines.push(`ssl-ca=${ca}`);
  } else if (mode === 'disable') {
    lines.push('skip-ssl');
  } else {
    lines.push('ssl');
    lines.push(mode === 'require' ? 'skip-ssl-verify-server-cert' : 'ssl-verify-server-cert');
    if (ca) lines.push(`ssl-ca=${ca}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Argumentos y entorno de cada herramienta (función pura, probada sin ejecutar nada). */
export function buildInvocation(
  job: BackupJob,
  defaultsPath: string,
  baseEnv: NodeJS.ProcessEnv,
): Invocation {
  const { config, database, file } = job;
  const host = config.host?.trim() || 'localhost';
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) if (value !== undefined) env[key] = value;

  if (job.family === 'postgres') {
    env['PGPASSWORD'] = job.secret ?? '';
    env['PGSSLMODE'] = config.ssl?.mode ?? 'disable';
    if (config.ssl?.caFile) env['PGSSLROOTCERT'] = config.ssl.caFile;
    env['PGCONNECT_TIMEOUT'] = String(config.connectTimeoutSec);
    env['PGAPPNAME'] = 'DB Explorer (respaldo)';
    const connection = [
      '--no-password',
      '-h',
      host,
      '-p',
      String(config.port ?? 5432),
      '-U',
      config.user ?? '',
    ];
    return job.kind === 'backup'
      ? { env, args: [...connection, '-d', database, '--format=custom', '--file', file] }
      : {
          env,
          // Atómico: si algo falla (p. ej. un rol del origen que no existe), no cambia nada.
          args: [
            ...connection,
            '-d',
            database,
            '--clean',
            '--if-exists',
            ...((job.options?.noOwner ?? true) ? ['--no-owner'] : []),
            ...((job.options?.noPrivileges ?? true) ? ['--no-privileges'] : []),
            '--single-transaction',
            file,
          ],
        };
  }

  const connection = [
    `--defaults-extra-file=${defaultsPath}`,
    '-h',
    host,
    '-P',
    String(config.port ?? 3306),
    '-u',
    config.user ?? '',
    '--default-character-set=utf8mb4',
  ];
  if (job.kind === 'backup') {
    const args = [
      ...connection,
      '--single-transaction',
      '--routines',
      '--triggers',
      '--events',
      `--result-file=${file}`,
      database,
    ];
    // Opciones que solo tiene mysqldump: sin PROCESS para los espacios de tablas, y sin GTID_PURGED
    // (con GTID activo el script no se podría volver a cargar en el mismo servidor).
    if (job.family === 'mysql') args.splice(args.length - 1, 0, '--no-tablespaces', '--set-gtid-purged=OFF');
    return { env, args, usesDefaultsFile: true };
  }
  return { env, args: [...connection, database], stdinFile: file, usesDefaultsFile: true };
}

/** Cuántos bytes del final de stderr se conservan para el mensaje de error. */
const STDERR_TAIL = 4000;

export class BackupError extends Error {
  constructor(
    message: string,
    readonly cancelled = false,
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

/** Ejecuta las herramientas auxiliares como procesos hijo, con cancelación y sin dejar contraseñas a la vista. */
export class BackupRunner {
  private readonly running = new Map<string, ChildProcess>();
  /** Operaciones iniciadas (aunque su proceso aún no haya arrancado): permite cancelar en cualquier momento. */
  private readonly active = new Set<string>();
  private readonly cancelled = new Set<string>();

  constructor(
    private readonly tools: AuxTools,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  cancel(operationId: string): boolean {
    if (!this.active.has(operationId)) return false;
    this.cancelled.add(operationId);
    this.running.get(operationId)?.kill();
    return true;
  }

  /** Devuelve el tamaño del archivo de respaldo al terminar bien. */
  async run(operationId: string, job: BackupJob): Promise<{ bytes: number }> {
    this.active.add(operationId);
    const [dumpName, restoreName] = toolFileNames(job.family, this.platform);
    let scratch: string | undefined;
    try {
      const exe = await this.tools.pathOf(job.family, job.kind === 'backup' ? dumpName! : restoreName!);
      if (!exe)
        throw new BackupError('Falta la herramienta auxiliar: importa los binarios antes de continuar');
      scratch = await mkdtemp(join(tmpdir(), 'dbx-'));
      const defaultsPath = join(scratch, 'client.cnf');
      const invocation = buildInvocation(job, defaultsPath, process.env);
      if (invocation.usesDefaultsFile) {
        await writeFile(defaultsPath, buildDefaultsFile(job.family, job.config, job.secret), { mode: 0o600 });
      }
      if (this.cancelled.has(operationId)) throw new BackupError('Operación cancelada', true);
      await this.spawnAndWait(operationId, exe, invocation, job);
      if (job.kind === 'backup') {
        const size = (await stat(job.file).catch(() => null))?.size ?? 0;
        if (size === 0)
          throw new BackupError('La herramienta terminó pero el archivo de respaldo quedó vacío');
        return { bytes: size };
      }
      return { bytes: (await stat(job.file)).size };
    } catch (err) {
      if (job.kind === 'backup') await rm(job.file, { force: true }).catch(() => undefined);
      throw err;
    } finally {
      this.running.delete(operationId);
      this.cancelled.delete(operationId);
      this.active.delete(operationId);
      if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private spawnAndWait(
    operationId: string,
    exe: string,
    invocation: Invocation,
    job: BackupJob,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(exe, invocation.args, {
        env: invocation.env,
        windowsHide: true,
        cwd: this.tools.dir(job.family),
        stdio: [invocation.stdinFile ? 'pipe' : 'ignore', 'ignore', 'pipe'],
      });
      this.running.set(operationId, child);
      if (this.cancelled.has(operationId)) child.kill();
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_TAIL);
      });
      child.on('close', (code) => {
        if (code === 0 && !this.cancelled.has(operationId)) resolve();
        else if (this.cancelled.has(operationId)) reject(new BackupError('Operación cancelada', true));
        else reject(new BackupError(this.failureMessage(job, code, stderr)));
      });
      child.on('error', (err) =>
        reject(new BackupError(`No se pudo ejecutar la herramienta: ${err.message}`)),
      );

      if (invocation.stdinFile && child.stdin) {
        const input = createReadStream(invocation.stdinFile);
        input.on('error', (err) => {
          child.kill();
          reject(new BackupError(`No se pudo leer el archivo: ${err.message}`));
        });
        // La herramienta puede cerrar la entrada antes (p. ej. un error de conexión): el motivo viene por stderr.
        child.stdin.on('error', () => undefined);
        input.pipe(child.stdin);
      }
    });
  }

  private failureMessage(job: BackupJob, code: number | null, stderr: string): string {
    let text = stderr.trim();
    if (job.secret) text = text.split(job.secret).join('***');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const detail = lines.slice(-6).join('\n');
    return detail || `La herramienta terminó con código ${code ?? 'desconocido'}`;
  }
}
