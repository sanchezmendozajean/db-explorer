# 03 — Capa de drivers

Todos los motores implementan la misma interfaz en `src/db-host/drivers/types.ts`. La UI nunca sabe qué motor hay debajo, salvo por `capabilities` y `dialect`.

## Interfaz

```ts
type Engine = 'postgres' | 'mariadb' | 'sqlite' | 'sqlserver';

interface DriverCapabilities {
  databases: boolean;        // sqlite: false
  schemas: boolean;          // mariadb: false (base = esquema), sqlite: false
  functions: boolean;
  procedures: boolean;
  sequences: boolean;
  triggers: boolean;
  cancel: boolean;
  multipleResultSets: boolean;
  batchSeparator?: 'GO';     // sqlserver
}

interface DbDriver {
  readonly engine: Engine;
  readonly capabilities: DriverCapabilities;

  connect(cfg: ConnectionConfig, secret?: string): Promise<ServerInfo>;
  disconnect(): Promise<void>;
  ping(): Promise<number>;                       // ms

  // Metadatos (carga perezosa)
  listDatabases(): Promise<DbObject[]>;
  listSchemas(db: string): Promise<DbObject[]>;
  listObjects(scope: Scope, kind: ObjectKind): Promise<DbObject[]>;
  getColumns(ref: ObjectRef): Promise<ColumnInfo[]>;
  getIndexes(ref: ObjectRef): Promise<IndexInfo[]>;
  getConstraints(ref: ObjectRef): Promise<ConstraintInfo[]>;   // PK, FK, UNIQUE, CHECK
  getDDL(ref: ObjectRef): Promise<string>;
  getCompletionCatalog(scope: Scope): Promise<CompletionCatalog>; // tablas+columnas de un esquema, en 1 llamada

  // Ejecución
  execute(req: ExecuteRequest, sink: ResultSink, signal: AbortSignal): Promise<ExecuteSummary>;
  cancel(queryId: string): Promise<void>;

  // Transacciones (una sesión por pestaña, ver "Sesiones")
  setAutoCommit(session: string, on: boolean): Promise<void>;
  commit(session: string): Promise<void>;
  rollback(session: string): Promise<void>;
}

interface ResultSink {
  columns(resultIndex: number, cols: ResultColumn[]): void; // nombre, tipo nativo, tipo lógico, tabla origen si se conoce
  rows(resultIndex: number, batch: unknown[][]): void;
  done(resultIndex: number, info: { rowCount: number; affected?: number; truncated: boolean }): void;
  message(text: string): void;                               // NOTICE / PRINT / warnings
}
```

`ObjectKind`: `table | view | materializedView | function | procedure | sequence | trigger`.

**Tipo lógico** de columna (para formatear y editar en la grilla): `integer | decimal | float | boolean | text | date | time | datetime | datetimetz | json | binary | uuid | other`. Cada driver mapea sus tipos nativos a estos.

## Sesiones
- Cada **pestaña de editor** obtiene una sesión dedicada (conexión física) cuando ejecuta por primera vez, para que variables de sesión, tablas temporales y transacciones manuales se mantengan.
- El **árbol y el autocompletado** usan una conexión de metadatos compartida por conexión.
- Ver datos de tabla usa la conexión de metadatos (solo lectura) salvo al guardar ediciones.
- Cerrar la pestaña con transacción abierta → diálogo: Commit / Rollback / Cancelar.

## Detalles por motor

### PostgreSQL — `pg`
- Metadatos: `pg_catalog` (más rápido que `information_schema`). Ocultar esquemas `pg_*` e `information_schema` bajo un nodo "Esquemas del sistema" colapsado.
- Cambiar de base = otra conexión (Postgres no permite `USE`).
- Cancelación: `pg_cancel_backend(pid)` desde la conexión de metadatos.
- Filas grandes: usar `pg-cursor` o `pg-query-stream` para leer en lotes y respetar el límite.
- `NOTICE` → `sink.message`.
- Tipos: en las sesiones de editor todo valor llega como **texto crudo del servidor** (`numeric`, `int8`, `float`, fechas, `json/jsonb`, `bytea`, arreglos…), salvo `boolean` y enteros de 32 bits; el formateo es solo de presentación en la UI (ver `NOTAS.md`, M3).
- SSL: `require`, `verify-ca`, `verify-full` con CA opcional (RDS).

### MariaDB / MySQL — `mysql2`
- "Base" y "esquema" son lo mismo: el árbol muestra Conexión → Bases → Tablas… (sin nivel esquema).
- Metadatos: `information_schema`.
- Cancelación: `KILL QUERY <thread_id>` desde la conexión de metadatos.
- Streaming: `query().stream()`.
- `multipleStatements: true` solo en sesiones de editor para ejecutar scripts; o mejor, separar sentencias en la app (ver "Separación").
- `decimalNumbers: false`, `dateStrings: true`, `supportBigNumbers: true`, `bigNumberStrings: true`.

### SQLite — `better-sqlite3`
- "Conexión" = ruta a archivo (+ opción "solo lectura" y "crear si no existe").
- Sin bases ni esquemas (mostrar `main` y bases adjuntas si las hay).
- Metadatos: `sqlite_schema`, `pragma_table_info`, `pragma_index_list`, `pragma_foreign_key_list`.
- Síncrono: al correr en el DB Host no bloquea la UI. Cancelación: `db.interrupt()` no existe en better-sqlite3 → ejecutar cada sesión SQLite en un `worker_thread` dentro del DB Host para poder terminarlo; documentarlo como limitación si no se implementa.
- Iteración por lotes con `stmt.iterate()`.
- `safeIntegers(true)` para enteros grandes.

### SQL Server — `mssql` (tedious)
- Árbol: Conexión → Bases → Esquemas → Tablas…
- Metadatos: `sys.*` (`sys.tables`, `sys.columns`, `sys.indexes`, …) en la base seleccionada.
- Separador de lotes `GO` (línea sola, insensible a mayúsculas, opcional `GO n`), resuelto en la app, no en el servidor.
- Cancelación: `request.cancel()`.
- Streaming: `request.stream = true` con eventos `row` / `recordset` / `done`.
- `PRINT` y mensajes informativos → `sink.message`.
- Opciones: `encrypt`, `trustServerCertificate`, instancia con nombre, puerto.
- Tipos: `decimal/money` como string, `datetime2` sin conversión de zona (`useUTC: false`), `uniqueidentifier` como texto.

## Separación de sentencias
Módulo `splitter/` por dialecto, usado para "ejecutar sentencia bajo el cursor" y para scripts:
- Separa por `;` respetando: comillas simples, dobles, `` ` `` (MariaDB), `[ ]` (SQL Server), comentarios `--` y `/* */`, *dollar quoting* de Postgres (`$$`, `$tag$`), bloques `BEGIN … END` de procedimientos (MariaDB `DELIMITER`), y `GO` en SQL Server.
- Devuelve rangos (offset inicio/fin + línea/columna) para resaltar la sentencia activa y reportar errores en su posición.
- Cobertura de tests unitarios amplia (es la pieza más propensa a bugs).

## Tests de integración
`test/integration/docker-compose.yml` con `postgres:16`, `mariadb:11`, `mcr.microsoft.com/mssql/server:2022-latest` y SQLite en archivo temporal. Un mismo set de tests corre contra los 4 drivers: conectar, listar, columnas, DDL, ejecutar SELECT/INSERT/error, cancelar, transacción manual, tipos (decimal, fecha, json, binario, null, unicode).
