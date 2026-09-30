import { z } from 'zod';

/** Modelo de conexión (specs/08). Nunca contiene contraseñas. */

export const EngineSchema = z.enum(['postgres', 'mariadb', 'sqlite', 'sqlserver']);
export type Engine = z.infer<typeof EngineSchema>;

export const EnvironmentSchema = z.enum(['local', 'dev', 'qa', 'prod']);
export type Environment = z.infer<typeof EnvironmentSchema>;

export const SslModeSchema = z.enum(['disable', 'require', 'verify-ca', 'verify-full']);
export type SslMode = z.infer<typeof SslModeSchema>;

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const ConnectionConfigSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  engine: EngineSchema,
  folder: z.string().trim().min(1).max(120).optional(),
  environment: EnvironmentSchema,
  color: HexColor.optional(),
  host: z.string().trim().max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  instance: z.string().trim().max(120).optional(),
  database: z.string().trim().max(255).optional(),
  user: z.string().max(255).optional(),
  file: z.string().max(4096).optional(),
  sqliteReadOnly: z.boolean().optional(),
  sqliteCreate: z.boolean().optional(),
  savePassword: z.boolean(),
  ssl: z
    .object({
      mode: SslModeSchema,
      caFile: z.string().max(4096).optional(),
      encrypt: z.boolean().optional(),
      trustServerCertificate: z.boolean().optional(),
    })
    .optional(),
  readOnly: z.boolean(),
  confirmWrites: z.boolean(),
  connectTimeoutSec: z.number().int().min(1).max(600),
  queryTimeoutSec: z.number().int().min(0).max(86_400),
  extra: z.record(z.string().max(200), z.string().max(2000)).optional(),
  showSystemObjects: z.boolean(),
});

export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>;

/**
 * Reglas que dependen de varios campos: host en motores de servidor, archivo
 * en SQLite. Se aplican al guardar y al probar, no al leer (una entrada vieja
 * incompleta se sigue mostrando para poder corregirla).
 */
export const CompleteConnectionSchema = ConnectionConfigSchema.superRefine((c, ctx) => {
  if (c.engine === 'sqlite') {
    if (!c.file?.trim()) ctx.addIssue({ code: 'custom', path: ['file'], message: 'required' });
  } else if (!c.host?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['host'], message: 'required' });
  }
});

/** Contenido de `connections.json`. El orden del arreglo es el orden en el árbol. */
export const ConnectionsFileSchema = z.object({
  version: z.literal(1),
  folders: z.array(z.string().trim().min(1).max(120)),
  connections: z.array(z.unknown()),
});

export interface ConnectionsState {
  folders: string[];
  connections: ConnectionConfig[];
}

export const DEFAULT_PORTS: Record<Engine, number | undefined> = {
  postgres: 5432,
  mariadb: 3306,
  sqlite: undefined,
  sqlserver: 1433,
};

export function newConnectionDefaults(engine: Engine, id: string): ConnectionConfig {
  return {
    id,
    name: '',
    engine,
    environment: 'local',
    host: engine === 'sqlite' ? undefined : 'localhost',
    port: DEFAULT_PORTS[engine],
    user:
      engine === 'postgres'
        ? 'postgres'
        : engine === 'sqlserver'
          ? 'sa'
          : engine === 'mariadb'
            ? 'root'
            : undefined,
    savePassword: engine !== 'sqlite',
    ssl: engine === 'sqlite' ? undefined : { mode: 'disable' },
    readOnly: false,
    confirmWrites: false,
    connectTimeoutSec: 15,
    queryTimeoutSec: 0,
    showSystemObjects: false,
  };
}

/** Texto secundario del árbol: `host:puerto` o nombre de archivo. */
export function connectionAddress(c: ConnectionConfig): string {
  if (c.engine === 'sqlite') return c.file ?? '';
  const host = c.host ?? '';
  const instance = c.instance ? `\\${c.instance}` : '';
  return c.port ? `${host}${instance}:${c.port}` : `${host}${instance}`;
}

/** Estado de conexión visto desde el renderer. */
export type ConnectionStatus =
  | { state: 'disconnected' }
  | { state: 'connecting' }
  | { state: 'connected'; server: ServerInfo }
  | { state: 'error'; message: string };

export interface ServerInfo {
  /** Texto para la status bar, p. ej. "PostgreSQL 16.2". */
  product: string;
  version: string;
  /** Tiempo de conexión en ms (para "Probar conexión"). */
  latencyMs: number;
}
