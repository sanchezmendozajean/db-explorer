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
- Streaming: eventos `fields` / `result` de `query()`; al llegar al límite se pausa el socket (`connection.pause()`) y la consulta queda como cursor para "Cargar más".
- `multipleStatements: false`: la app separa las sentencias (ver "Separación"); `CALL` puede devolver varios resultados.
- `decimalNumbers: false`, `dateStrings: true`, `supportBigNumbers: true`, `bigNumberStrings: true`; `typeCast`: enteros de hasta 32 bits como número, `BIT(1)` como booleano, binarios como `0x…`, el resto como texto crudo.
- Avisos del servidor: cuando una respuesta OK informa avisos se lee `SHOW WARNINGS` y se muestran en Mensajes (`mysql2` no informa la cantidad de avisos de un `SELECT`).
- Tiempo límite de consulta: `max_statement_time` (MariaDB) o `max_execution_time` (MySQL, solo `SELECT`).

### SQLite — `node:sqlite` (ver `NOTAS.md`, M4: desvío de D14 pendiente de confirmar)
- "Conexión" = ruta a archivo (+ opción "solo lectura" y "crear si no existe").
- Sin bases ni esquemas: el árbol muestra directamente las carpetas de `main` (las bases adjuntas no se muestran en v1).
- Metadatos: `sqlite_schema`, `pragma_table_info`, `pragma_index_list`, `pragma_index_info`. Una clave `INTEGER PRIMARY KEY` (rowid) se muestra como índice primario.
- Síncrono y sin `interrupt()`: cada sesión de editor corre en un `worker_thread` del DB Host; cancelar termina el hilo y la siguiente ejecución abre otro (se pierde una transacción abierta). Limitación: V8 detiene el hilo al volver de SQLite a JavaScript; un paso nativo largo (p. ej. un `count(*)` enorme) sigue hasta terminar ese paso, aunque la pestaña queda libre de inmediato.
- Iteración por lotes con `stmt.iterate()`, `setReturnArrays(true)` y `setReadBigInts(true)` (enteros fuera del rango seguro como texto). Tabla de origen de cada columna con `stmt.columns()`.

### SQL Server — `tedious` (la base de `mssql`, usada directamente; ver `NOTAS.md`, M4)
- Árbol: Conexión → Bases → Esquemas → Tablas… (roles fijos `db_*`, `sys`, `INFORMATION_SCHEMA` y `guest` en "Esquemas del sistema").
- Metadatos: `sys.*` con nombres de tres partes (`[base].sys.tables`) en una conexión compartida con cola (`tedious` atiende una petición a la vez).
- Separador de lotes `GO` (línea sola, insensible a mayúsculas, opcional `GO n`: el número se acepta pero no repite el lote), resuelto en la app, no en el servidor.
- Cada sentencia se envía como lote (`execSqlBatch`) para que las tablas `#temp` y las variables de sesión se conserven.
- Cancelación: `connection.cancel()`. Streaming: eventos `columnMetadata` / `row` / `done` con `request.pause()` al llegar al límite. Una sentencia puede devolver varios resultados (bloques, `EXEC`).
- Tabla de origen, tipo exacto y clave del primer resultado: `sys.dm_exec_describe_first_result_set` en la conexión de metadatos (`tedious` no lee los tokens de tabla del protocolo).
- `PRINT` y mensajes informativos → `sink.message`.
- Opciones: `encrypt`, `trustServerCertificate`, instancia con nombre, puerto; con "solo lectura" se pide `ApplicationIntent=ReadOnly` (no lo garantiza: el bloqueo real es el del cliente).
- Tipos: `decimal`, `numeric` y `money` como texto exacto y fechas (`date`, `time`, `datetime`, `datetime2`, `datetimeoffset` con su desplazamiento) como texto sin conversión de zona. `tedious` los convierte a `Number`/`Date`; se reemplaza su lector de valores para esos tipos en tiempo de ejecución, sin parchear `node_modules` (`exact-values.ts`). `uniqueidentifier` como texto, `bigint` como texto.
- El esquema por defecto es del usuario, no de la sesión: el editor no muestra selector de esquema (solo PostgreSQL lo tiene).

## Separación de sentencias
Módulo `splitter/` por dialecto, usado para "ejecutar sentencia bajo el cursor" y para scripts:
- Separa por `;` respetando: comillas simples, dobles, `` ` `` (MariaDB), `[ ]` (SQL Server), comentarios `--` y `/* */`, *dollar quoting* de Postgres (`$$`, `$tag$`), bloques `BEGIN … END` de procedimientos (MariaDB `DELIMITER`), y `GO` en SQL Server.
- Devuelve rangos (offset inicio/fin + línea/columna) para resaltar la sentencia activa y reportar errores en su posición.
- Cobertura de tests unitarios amplia (es la pieza más propensa a bugs).

## Tests de integración
`test/integration/docker-compose.yml` con `postgres:16`, `mariadb:11`, `mcr.microsoft.com/mssql/server:2022-latest` y SQLite en archivo temporal. Un mismo set de tests corre contra los 4 drivers: conectar, listar, columnas, DDL, ejecutar SELECT/INSERT/error, cancelar, transacción manual, tipos (decimal, fecha, json, binario, null, unicode). Implementado en `test/integration/common-suite.test.ts` + `engines.ts`; un motor sin servidor alcanzable se salta con el motivo, y uno marcado de solo lectura (`MARIADB_READONLY=1`) salta las pruebas que escriben. DDL y la transacción manual con Commit/Rollback llegan con M7 (hoy se prueba `BEGIN … ROLLBACK` en la misma sesión).
