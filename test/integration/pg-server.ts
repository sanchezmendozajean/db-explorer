import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';

const run = promisify(execFile);

/**
 * Ejecuta `pg_ctl` sin capturar su salida: en Windows el servidor hereda los
 * pipes y `execFile` esperaría para siempre a que se cierren.
 */
function pgCtl(bin: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(join(bin, 'pg_ctl.exe'), args, { stdio: 'ignore', windowsHide: true });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`pg_ctl terminó con código ${code}`)),
    );
  });
}

export interface PgTestConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/** Lee `test/integration/.env` (si existe) con los valores de `.env.example` como respaldo. */
export function pgTestConfig(): PgTestConfig {
  const values: Record<string, string> = {};
  for (const name of ['.env.example', '.env']) {
    const file = resolve(__dirname, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) values[m[1]!] = m[2]!;
    }
  }
  const get = (key: string, fallback: string): string => process.env[key] ?? values[key] ?? fallback;
  return {
    host: get('PG_HOST', '127.0.0.1'),
    port: Number(get('PG_PORT', '55432')),
    user: get('PG_USER', 'dbx'),
    password: get('PG_PASSWORD', 'dbx_test_pw'),
    database: get('PG_DATABASE', 'dbx_test'),
  };
}

async function canConnect(cfg: PgTestConfig): Promise<boolean> {
  const client = new pg.Client({ ...cfg, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

/** Carpeta `bin` de una instalación local de PostgreSQL (Windows), o `PG_BIN`. */
function findPgBin(): string | undefined {
  if (process.env['PG_BIN'] && existsSync(join(process.env['PG_BIN'], 'pg_ctl.exe')))
    return process.env['PG_BIN'];
  const base = 'C:\\Program Files\\PostgreSQL';
  if (!existsSync(base)) return undefined;
  const versions = readdirSync(base)
    .filter((v) => existsSync(join(base, v, 'bin', 'pg_ctl.exe')))
    .sort((a, b) => Number(b) - Number(a));
  return versions[0] ? join(base, versions[0], 'bin') : undefined;
}

export interface PgServerHandle {
  config: PgTestConfig;
  /** true si se levantó un clúster temporal (y hay que detenerlo). */
  temporary: boolean;
  stop(): Promise<void>;
}

/**
 * Garantiza un PostgreSQL de pruebas: usa el configurado (p. ej. el de
 * docker-compose) o, si no responde, levanta un clúster temporal con los
 * binarios locales en un directorio desechable. Nunca toca otros servidores.
 */
export async function ensurePostgres(): Promise<PgServerHandle> {
  const config = pgTestConfig();
  if (await canConnect(config)) return { config, temporary: false, stop: async () => undefined };

  const bin = findPgBin();
  if (!bin) {
    throw new Error(
      'No hay PostgreSQL de pruebas: levanta test/integration/docker-compose.yml o instala PostgreSQL (o define PG_BIN).',
    );
  }
  const dir = mkdtempSync(join(tmpdir(), 'dbx-pg-'));
  const data = join(dir, 'data');
  const pwfile = join(dir, 'pw.txt');
  writeFileSync(pwfile, config.password);
  await run(join(bin, 'initdb.exe'), [
    '-D',
    data,
    '-U',
    config.user,
    `--pwfile=${pwfile}`,
    '-A',
    'scram-sha-256',
    '-E',
    'UTF8',
    '--no-locale',
  ]);
  rmSync(pwfile);
  await pgCtl(bin, [
    '-D',
    data,
    '-l',
    join(dir, 'server.log'),
    '-o',
    `-p ${config.port} -c listen_addresses=${config.host}`,
    '-w',
    'start',
  ]);

  const admin = new pg.Client({ ...config, database: 'postgres' });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${config.database}`);
  await admin.end();

  return {
    config,
    temporary: true,
    stop: async () => {
      await pgCtl(bin, ['-D', data, '-m', 'fast', '-w', 'stop']).catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Esquema de ejemplo para las pruebas de metadatos (nombres con mayúsculas incluidos). */
export const PG_FIXTURE_SQL = `
DROP SCHEMA IF EXISTS dbx CASCADE;
CREATE SCHEMA dbx;
CREATE TABLE dbx."CRendiciones_Conf_Generales" (
  id serial PRIMARY KEY,
  "Nombre" varchar(120) NOT NULL,
  "ImporteLimite" numeric(12,2),
  "Activo" boolean DEFAULT true,
  "FechaDeCreacion" timestamp NOT NULL DEFAULT now()
);
COMMENT ON COLUMN dbx."CRendiciones_Conf_Generales"."Nombre" IS 'Nombre del parámetro';
CREATE INDEX idx_conf_nombre ON dbx."CRendiciones_Conf_Generales" ("Nombre", "Activo");
CREATE TABLE dbx.clientes (id int PRIMARY KEY, nombre text);
CREATE VIEW dbx.vw_activos AS SELECT id, "Nombre" FROM dbx."CRendiciones_Conf_Generales" WHERE "Activo";
CREATE MATERIALIZED VIEW dbx.mv_resumen AS SELECT count(*) AS n FROM dbx.clientes;
CREATE FUNCTION dbx.fn_doble(p integer) RETURNS integer LANGUAGE sql AS 'SELECT p * 2';
CREATE PROCEDURE dbx.pr_nada() LANGUAGE sql AS 'SELECT 1';
CREATE SEQUENCE dbx.seq_extra;
`;
