import type { Engine } from './connection';
import { quoteIdent } from './sql-quote';

/**
 * Administración de bases de datos: crear, eliminar, renombrar, respaldar y restaurar.
 * PostgreSQL y MariaDB/MySQL respaldan con herramientas auxiliares que el usuario aporta
 * (`ToolFamily`); SQL Server lo hace con `BACKUP`/`RESTORE` en el servidor.
 */

/** Familia de herramientas auxiliares. MariaDB y MySQL son independientes: cada una trae sus binarios. */
export type ToolFamily = 'postgres' | 'mariadb' | 'mysql';

export const TOOL_FAMILIES: readonly ToolFamily[] = ['postgres', 'mariadb', 'mysql'];

/** Binarios (sin extensión) que se piden por familia: el primero respalda y el segundo restaura. */
const TOOL_BASENAMES: Record<ToolFamily, readonly [dump: string, restore: string]> = {
  postgres: ['pg_dump', 'pg_restore'],
  mariadb: ['mariadb-dump', 'mariadb'],
  mysql: ['mysqldump', 'mysql'],
};

/** Nombre de archivo de un binario según la plataforma (`.exe` en Windows). */
export function toolFileNames(family: ToolFamily, platform: string): string[] {
  const suffix = platform === 'win32' ? '.exe' : '';
  return TOOL_BASENAMES[family].map((name) => `${name}${suffix}`);
}

/** Familia de herramientas que corresponde a una conexión; `null` si el motor no las usa. */
export function toolFamilyOf(engine: Engine, product: string | undefined): ToolFamily | null {
  if (engine === 'postgres') return 'postgres';
  if (engine === 'mariadb') return /^mysql/i.test(product ?? '') ? 'mysql' : 'mariadb';
  return null;
}

/** ¿El motor renombra bases de forma nativa? MariaDB/MySQL no (y no se simula); SQLite no aplica. */
export function canRenameDatabase(engine: Engine): boolean {
  return engine === 'postgres' || engine === 'sqlserver';
}

/**
 * Sentencias que ejecuta el renombrado de una base, para mostrarlas antes de aplicarlo.
 * Reflejan las de los drivers (`renameDatabase` en postgres y sqlserver).
 */
export function renameDatabaseStatements(engine: Engine, from: string, to: string): string[] {
  if (engine === 'postgres') {
    return [
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${from.replace(/'/g, "''")}' AND pid <> pg_backend_pid()`,
      `ALTER DATABASE ${quoteIdent('postgres', from)} RENAME TO ${quoteIdent('postgres', to)}`,
    ];
  }
  if (engine === 'sqlserver') {
    const [a, b] = [from, to].map((n) => `[${n.replace(/]/g, ']]')}]`) as [string, string];
    return [
      `ALTER DATABASE ${a} SET SINGLE_USER WITH ROLLBACK IMMEDIATE`,
      `ALTER DATABASE ${a} MODIFY NAME = ${b}`,
      `ALTER DATABASE ${b} SET MULTI_USER`,
    ];
  }
  return [];
}

/** Cómo respalda y restaura cada motor. */
export type BackupMode = 'tools' | 'server' | 'none';

export function backupModeOf(engine: Engine): BackupMode {
  if (engine === 'sqlserver') return 'server';
  if (engine === 'sqlite') return 'none';
  return 'tools';
}

/** Un binario importado, tal como se informa a la interfaz. */
export interface ToolFileStatus {
  /** Nombre del archivo esperado (con extensión). */
  name: string;
  installed: boolean;
  /** Versión leída de `--version` (p. ej. `18.0`); ausente si no se pudo leer. */
  version?: string;
  /** Línea completa de `--version`, para mostrarla como detalle. */
  banner?: string;
  /** Bibliotecas (.dll) que necesita y si ya están en la carpeta interna: así se ve qué falta antes de continuar. */
  libraries?: { name: string; installed: boolean }[];
}

export interface ToolFamilyStatus {
  family: ToolFamily;
  files: ToolFileStatus[];
}

/** Resultado de importar archivos: el estado de la familia y lo que se rechazó. */
export interface ToolImportResult {
  status: ToolFamilyStatus;
  /** Archivos que no se aceptaron, con el motivo (ya en español). */
  rejected: { path: string; reason: string }[];
}

/**
 * Extrae la versión de la salida de `--version` y comprueba que sea la herramienta esperada.
 * `pg_dump (PostgreSQL) 18.0`, `mysqldump  Ver 8.4.0 for Win64…`, `mariadb-dump from 11.4.2-MariaDB, client…`.
 */
export function parseToolVersion(
  family: ToolFamily,
  output: string,
): { version: string; banner: string } | null {
  const banner =
    output
      .split(/\r?\n/)
      .find((l) => l.trim())
      ?.trim() ?? '';
  if (!banner) return null;
  const patterns: Record<ToolFamily, RegExp> = {
    postgres: /\(PostgreSQL\)\s+(\d+(?:\.\d+)*)/i,
    mariadb: /(\d+(?:\.\d+)+)-MariaDB/i,
    mysql: /\bVer\s+(\d+(?:\.\d+)+)[^\n]*(?:MySQL|Community)/i,
  };
  const match = patterns[family].exec(banner);
  const version = match?.[1];
  return version ? { version, banner } : null;
}

/** Versión mayor de un texto como `18.0` o `11.4.2`. */
export function majorVersion(version: string): number {
  return Number.parseInt(version.split('.')[0] ?? '', 10);
}

/** Nombre sugerido para el archivo de respaldo: `base-AAAAMMDD-HHMM.ext`. */
export function suggestedBackupName(engine: Engine, database: string, now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const ext = engine === 'postgres' ? 'backup' : engine === 'sqlserver' ? 'bak' : 'sql';
  return `${database}-${stamp}.${ext}`;
}

/** Filtros del diálogo de archivos según el motor. */
export function backupFileFilters(engine: Engine): { name: string; extensions: string[] }[] {
  switch (engine) {
    case 'postgres':
      return [{ name: 'Respaldo de PostgreSQL', extensions: ['backup', 'dump'] }];
    case 'sqlserver':
      return [{ name: 'Respaldo de SQL Server', extensions: ['bak'] }];
    default:
      return [{ name: 'Script SQL', extensions: ['sql'] }];
  }
}

/** Opciones al restaurar. `noOwner` y `noPrivileges` son de `pg_restore`; `removeDefiner` de MariaDB/MySQL. */
export interface RestoreOptions {
  /** `--no-owner`: los objetos quedan a nombre del usuario que conecta (por defecto, sí). */
  noOwner?: boolean;
  /** `--no-privileges`: no se aplican los GRANT/REVOKE del respaldo (por defecto, sí). */
  noPrivileges?: boolean;
  /** Quita las cláusulas `DEFINER=…` del script mientras se envía al cliente (por defecto, sí). */
  removeDefiner?: boolean;
}

/** Opciones al respaldar con `mysqldump`/`mariadb-dump` (por defecto: rutinas, disparadores y eventos, con datos). */
export interface DumpOptions {
  /** `--routines` */
  routines?: boolean;
  /** `--triggers` (si no, `--skip-triggers`) */
  triggers?: boolean;
  /** `--events` */
  events?: boolean;
  /** `--no-data`: solo estructura. */
  structureOnly?: boolean;
}
