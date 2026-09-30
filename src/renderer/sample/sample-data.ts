/**
 * Datos falsos para el hito M1 (shell visual), tomados de specs/maqueta.
 * Se reemplazan por datos reales a partir de M2 (conexiones) y M3 (editor y resultados).
 */

export type Environment = 'local' | 'dev' | 'qa' | 'prod';
export type Engine = 'postgres' | 'mariadb' | 'sqlite' | 'sqlserver';

export interface SampleConnection {
  id: string;
  name: string;
  engine: Engine;
  environment: Environment;
  /** `host:puerto` o ruta del archivo. */
  address: string;
  serverVersion: string;
  database?: string;
  schema?: string;
}

export interface SampleTreeNode {
  id: string;
  label: string;
  kind: 'connection' | 'database' | 'schema' | 'folder' | 'table' | 'view' | 'function' | 'sequence' | 'file';
  secondary?: string;
  connectionId?: string;
  /** Solo en archivos: marca de cambios sin guardar. */
  modified?: boolean;
  children?: SampleTreeNode[];
}

export const SAMPLE_WORKSPACE = { name: 'DB Explorer', path: 'C:\\Users\\usuario\\Documents\\DB Explorer' };

export const SAMPLE_CONNECTIONS: SampleConnection[] = [
  {
    id: 'local',
    name: 'local',
    engine: 'postgres',
    environment: 'local',
    address: 'localhost:5432',
    serverVersion: 'PostgreSQL 16.4',
    database: 'postgres',
    schema: 'public',
  },
  {
    id: 'paybox-prod',
    name: 'PayBox Prod',
    engine: 'postgres',
    environment: 'prod',
    address: 'extendspro.ctqoiasdeqhp.us-east-1.rds.amazonaws.com:5432',
    serverVersion: 'PostgreSQL 16.2',
    database: 'paybox',
    schema: 'public',
  },
  {
    id: 'sga-test',
    name: 'SGA TEST',
    engine: 'postgres',
    environment: 'qa',
    address: 'tawa-app-db-des-001.ctqoiasdeqhp.us-east-1.rds.amazonaws.com:5432',
    serverVersion: 'PostgreSQL 15.6',
    database: 'sga',
    schema: 'public',
  },
  {
    id: 'requerimientos',
    name: 'requerimientos.db',
    engine: 'sqlite',
    environment: 'local',
    address: 'D:\\datos\\requerimientos.db',
    serverVersion: 'SQLite 3.46',
  },
];

const PAYBOX_TABLES: [string, string][] = [
  ['CRendiciones_Conf_Generales', '15'],
  ['ControlesDeRendiciones_Cabeceras', '8,2 k'],
  ['ControlesDeRendiciones_Rendiciones', '41 k'],
  ['ModelosDeAprobacion_Aprobadores', '312'],
  ['ModelosDeAprobacion_Modelos', '24'],
  ['Provisiones_Cabeceras', '39 k'],
  ['Provisiones_Detalles', '127 k'],
  ['Usuarios', '1,1 k'],
];

const leaf = (prefix: string, kind: SampleTreeNode['kind'], names: string[]): SampleTreeNode[] =>
  names.map((name) => ({ id: `${prefix}/${name}`, label: name, kind }));

export const SAMPLE_CONNECTION_TREE: SampleTreeNode[] = [
  {
    id: 'local',
    label: 'local',
    kind: 'connection',
    connectionId: 'local',
    secondary: 'localhost:5432',
    children: [
      {
        id: 'local/postgres',
        label: 'postgres',
        kind: 'database',
        children: [
          {
            id: 'local/postgres/public',
            label: 'public',
            kind: 'schema',
            children: [
              {
                id: 'local/postgres/public/tables',
                label: 'Tablas',
                kind: 'folder',
                secondary: '(2)',
                children: leaf('local/postgres/public/tables', 'table', ['clientes', 'pedidos']),
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'paybox-prod',
    label: 'PayBox Prod',
    kind: 'connection',
    connectionId: 'paybox-prod',
    secondary: 'extendspro.ctqoiasdeqhp.us-east-1.rds.amazonaws.com:5432',
    children: [
      {
        id: 'pb/paybox',
        label: 'paybox',
        kind: 'database',
        secondary: '2,4 GB',
        children: [
          {
            id: 'pb/paybox/public',
            label: 'public',
            kind: 'schema',
            children: [
              {
                id: 'pb/paybox/public/tables',
                label: 'Tablas',
                kind: 'folder',
                secondary: '(48)',
                children: PAYBOX_TABLES.map(([name, rows]) => ({
                  id: `pb/paybox/public/tables/${name}`,
                  label: name,
                  kind: 'table' as const,
                  secondary: rows,
                })),
              },
              {
                id: 'pb/paybox/public/views',
                label: 'Vistas',
                kind: 'folder',
                secondary: '(6)',
                children: leaf('pb/paybox/public/views', 'view', [
                  'vw_rendiciones_pendientes',
                  'vw_aprobaciones',
                ]),
              },
              {
                id: 'pb/paybox/public/functions',
                label: 'Funciones',
                kind: 'folder',
                secondary: '(12)',
                children: leaf('pb/paybox/public/functions', 'function', [
                  'fn_cerrar_rendicion(p_id integer)',
                ]),
              },
              {
                id: 'pb/paybox/public/sequences',
                label: 'Secuencias',
                kind: 'folder',
                secondary: '(31)',
                children: leaf('pb/paybox/public/sequences', 'sequence', ['usuarios_id_seq']),
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'sga-test',
    label: 'SGA TEST',
    kind: 'connection',
    connectionId: 'sga-test',
    secondary: 'tawa-app-db-des-001.ctqoiasdeqhp.us-east-1.rds.amazonaws.com:5432',
    children: [
      {
        id: 'sga/sga',
        label: 'sga',
        kind: 'database',
        children: [
          {
            id: 'sga/sga/public',
            label: 'public',
            kind: 'schema',
            children: [
              {
                id: 'sga/sga/public/tables',
                label: 'Tablas',
                kind: 'folder',
                secondary: '(1)',
                children: leaf('sga/sga/public/tables', 'table', ['Rendiciones_Historial']),
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'requerimientos',
    label: 'requerimientos.db',
    kind: 'connection',
    connectionId: 'requerimientos',
    secondary: 'D:\\datos\\requerimientos.db',
    children: [
      {
        id: 'req/tables',
        label: 'Tablas',
        kind: 'folder',
        secondary: '(1)',
        children: leaf('req/tables', 'table', ['requerimientos']),
      },
    ],
  },
];

/** Nodos expandidos al iniciar (como en la pantalla 1 de la maqueta). */
export const SAMPLE_EXPANDED = ['paybox-prod', 'pb/paybox', 'pb/paybox/public', 'pb/paybox/public/tables'];

const file = (dir: string, name: string, modified = false): SampleTreeNode => ({
  id: `${dir}/${name}`,
  label: name,
  kind: 'file',
  modified,
});

export const SAMPLE_FILE_TREE: SampleTreeNode[] = [
  {
    id: 'paybox',
    label: 'paybox',
    kind: 'folder',
    children: [
      file('paybox', 'Script-1.sql'),
      file('paybox', 'Script-2.sql'),
      file('paybox', 'Script-3.sql'),
      file('paybox', 'Script-5.sql', true),
      file('paybox', 'rendiciones_pendientes.sql'),
    ],
  },
  {
    id: 'sga',
    label: 'sga',
    kind: 'folder',
    children: [file('sga', 'Script-4.sql'), file('sga', 'Script-6.sql')],
  },
  {
    id: 'exportaciones',
    label: 'exportaciones',
    kind: 'folder',
    children: [file('exportaciones', 'backup_rendiciones_2025.sql')],
  },
  { id: 'plantillas', label: 'plantillas', kind: 'folder', children: [] },
  file('', 'conexiones.json'),
  file('', 'datos_prueba.csv'),
  file('', 'README.md'),
];

export const SAMPLE_FILES_EXPANDED = ['paybox', 'sga'];

export const SAMPLE_SCRIPTS: Record<
  string,
  { lines: string[]; activeRange: [number, number]; cursor: [number, number] }
> = {
  'Script-1': {
    lines: ['-- Consultas de prueba en local', 'select * from clientes order by id desc limit 50;', ''],
    activeRange: [2, 2],
    cursor: [2, 51],
  },
  'Script-2': {
    lines: [
      'select * from "ControlesDeRendiciones_Rendiciones" where id = 15975;',
      '',
      'select * from "ControlesDeRendiciones_Rendiciones" order by id desc limit 100;',
      '',
      'select * from "ControlesDeRendiciones_Cabeceras" where "Tipo" = \'ER\' order by id desc limit 100;',
      '',
      'select * from "ModelosDeAprobacion_Aprobadores";',
      '',
      'select "FechaDeEstorno", * from "Provisiones_Cabeceras" where id = 39572;',
      '',
      'select * from "CRendiciones_Conf_Generales";',
    ],
    activeRange: [11, 11],
    cursor: [11, 45],
  },
};

export type LogicalType = 'integer' | 'text' | 'datetime' | 'decimal' | 'boolean';

export interface SampleColumn {
  name: string;
  type: LogicalType;
  nativeType: string;
  primaryKey?: boolean;
  width: number;
}

export const SAMPLE_RESULT = {
  title: 'CRendiciones_Conf_Generales',
  durationMs: 12,
  executedAt: '08:47:07',
  columns: [
    { name: 'id', type: 'integer', nativeType: 'integer', primaryKey: true, width: 80 },
    { name: 'Nombre', type: 'text', nativeType: 'character varying(120)', width: 300 },
    { name: 'FechaDeCreacion', type: 'datetime', nativeType: 'timestamp without time zone', width: 210 },
    { name: 'ImporteLimite', type: 'decimal', nativeType: 'numeric(12,2)', width: 150 },
    { name: 'Activo', type: 'boolean', nativeType: 'boolean', width: 80 },
    { name: 'Observacion', type: 'text', nativeType: 'text', width: 300 },
  ] satisfies SampleColumn[],
  rows: [
    [1, 'Límite diario de rendición', '2026-09-30 08:42:52.658', '45.20', true, null],
    [
      2,
      'Importe máximo por documento',
      '2026-01-12 10:15:03.221',
      '999999999.00',
      true,
      'Sin tope operativo',
    ],
    [3, 'Días para rendir anticipo', '2026-01-12 10:15:03.221', '15.00', true, null],
    [4, 'Tolerancia de redondeo', '2026-02-03 16:40:11.004', '0.05', true, 'Aplica solo en PEN'],
    [5, 'Monto mínimo de caja chica', '2026-02-03 16:41:27.930', '200.00', true, null],
    [6, 'Límite de movilidad local', '2026-03-18 09:02:45.117', '120.00', false, 'Reemplazado por regla v2'],
    [7, 'Límite de alimentación por día', '2026-03-18 09:05:12.480', '80.00', true, null],
    [8, 'Límite de hospedaje nacional', '2026-04-07 11:30:00.000', '350.00', true, null],
    [9, 'Límite de hospedaje extranjero', '2026-04-07 11:31:48.662', '1200.00', true, 'Monto en USD'],
    [10, 'Aprobación automática hasta', '2026-05-21 14:12:09.305', '500.00', false, null],
    [11, 'Retención de comprobantes (días)', '2026-06-02 08:00:00.000', '30.00', true, null],
    [12, 'Máximo de rendiciones abiertas', '2026-06-15 17:45:33.890', '3.00', true, 'Por colaborador'],
    [13, 'Tope de reembolso por kilómetro', '2026-07-01 10:20:14.552', '1.35', true, null],
    [14, 'Límite de gastos de representación', '2026-08-11 12:05:47.019', '750.00', true, null],
    [15, 'Plazo de observación del aprobador', '2026-09-02 09:14:26.773', '5.00', false, null],
  ] as (string | number | boolean | null)[][],
};

export function sampleConnection(id: string | undefined): SampleConnection | undefined {
  return SAMPLE_CONNECTIONS.find((c) => c.id === id);
}

/** Objetos de BD para la búsqueda rápida (Ctrl+P). */
export function sampleSearchableObjects(): {
  name: string;
  kind: SampleTreeNode['kind'];
  path: string;
  connectionId: string;
}[] {
  const out: { name: string; kind: SampleTreeNode['kind']; path: string; connectionId: string }[] = [];
  const walk = (nodes: SampleTreeNode[], trail: string[], connectionId: string): void => {
    for (const n of nodes) {
      const conn = n.kind === 'connection' ? (n.connectionId ?? n.id) : connectionId;
      if (n.kind === 'table' || n.kind === 'view' || n.kind === 'function') {
        out.push({ name: n.label, kind: n.kind, path: trail.join(' › '), connectionId: conn });
      }
      const nextTrail =
        n.kind === 'connection' || n.kind === 'database' || n.kind === 'schema' ? [...trail, n.label] : trail;
      if (n.children) walk(n.children, nextTrail, conn);
    }
  };
  walk(SAMPLE_CONNECTION_TREE, [], '');
  return out;
}

/** Archivos del espacio para la búsqueda rápida. */
export function sampleSearchableFiles(): { name: string; dir: string }[] {
  const out: { name: string; dir: string }[] = [];
  const walk = (nodes: SampleTreeNode[], dir: string[]): void => {
    for (const n of nodes) {
      if (n.kind === 'file') out.push({ name: n.label, dir: [SAMPLE_WORKSPACE.name, ...dir].join('\\') });
      if (n.children) walk(n.children, [...dir, n.label]);
    }
  };
  walk(SAMPLE_FILE_TREE, []);
  return out;
}
