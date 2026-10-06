---
name: motores-y-drivers
description: Particularidades de PostgreSQL, MariaDB/MySQL, SQLite y SQL Server (y de pg, mysql2, node:sqlite y tedious) aprendidas al construir los drivers del db-host - tipos, cancelación, transacciones, planes de ejecución. Usar antes de tocar src/db-host o de escribir SQL específico de un motor.
---

# Motores y drivers del db-host

Arquitectura en `specs/02` y `specs/03`; decisiones por hito en `specs/NOTAS.md`. Aquí, lo que no es obvio de cada motor.

## Comunes
- Valores sin pérdida: decimales, enteros grandes, fechas, JSON y binarios viajan como **texto crudo** del motor; el formateo es solo de presentación (`src/shared/query.ts`).
- Errores: `DriverError` con mensaje apto para mostrar y posición 1-based dentro de la sentencia. Si el driver antepone texto (p. ej. `EXPLAIN (...)`), restar el largo del prefijo a la posición.
- Transacciones del guardado de la grilla y de *Explicar y ejecutar*: `src/db-host/transaction-sql.ts`. En auto-commit `BEGIN … COMMIT/ROLLBACK`; con transacción manual abierta, punto de guardado `dbx_guardado` (SQL Server no libera puntos de guardado).
- Modo manual por motor: PostgreSQL, SQLite y SQL Server abren `BEGIN` antes de cada sentencia si no hay transacción; MariaDB usa `SET autocommit = 0` (volver a 1 confirma).

## PostgreSQL (`pg`)
- `client.getTransactionStatus()` (`'I'` = sin transacción) evita `COMMIT`/`BEGIN` de más.
- Arreglos de tipos internos: `array_position` sobre `char[]` falla y `name[]` no lo parsea `pg`; usar `strpos('pufc', contype::text)` y `attname::text`.
- Tipos de sesión: solo bool e int2/int4/oid se convierten; el resto queda como texto crudo (`sessionTypes`). `json` llega como texto.
- Cancelar: `pg_cancel_backend(pid)` desde la conexión de metadatos.
- Planes: `EXPLAIN (FORMAT JSON, VERBOSE[, ANALYZE, BUFFERS])`. `Plan Rows` es por bucle y **después** del filtro; para "filas leídas" usar `pg_class.reltuples` (−1 si nunca se analizó). PG 18 devuelve `Actual Rows` con decimales.

## MariaDB / MySQL (`mysql2`)
- MySQL usa el mismo driver (motor `mariadb`); se detecta con `VERSION()` al conectar. Probado con MySQL 26.7 (numeración nueva de versiones).
- MySQL declara `BIGINT` los literales enteros (`SELECT 1`, `count(*)`, CTE recursivos) y los BIGINT llegan como texto: no convertirlos según el ancho declarado (un CTE recursivo informa ancho 2 aunque sus valores crezcan).
- MySQL corta los CTE recursivos en 1000 niveles (`cte_max_recursion_depth`): pista `/*+ SET_VAR(cte_max_recursion_depth = N) */` tras el SELECT principal, o `SET SESSION`.
- El mismo driver sirve a ambos; `isMariaDb` se detecta con `VERSION()` al conectar (secuencias, `max_statement_time` vs `max_execution_time`, formato de plan).
- Las filas se leen en flujo; al llegar al límite se pausa el socket y la consulta queda como cursor (las filas del bloque ya recibido van a `overflow`). Mientras el cursor está abierto la conexión está ocupada.
- Avisos: `mysql2` solo informa su cantidad en respuestas OK, no en SELECT.
- Cancelar: `KILL QUERY <thread>` desde la conexión de metadatos. `KILL QUERY` sobre `SLEEP()` no da error (devuelve 1): informar igual como cancelada.
- `affectedRows` cuenta filas **encontradas** (`mysql2` activa `FOUND_ROWS` por defecto): un UPDATE al mismo valor cuenta 1 (importante para "afecta exactamente una fila").
- CTE recursivos cortados en silencio a 1000 iteraciones (`max_recursive_iterations`); usar `seq_1_to_N`.
- Planes: MariaDB `EXPLAIN`/`ANALYZE FORMAT=JSON` (en `ANALYZE` el `r_total_time_ms` del `query_block` incluye todo, el de `filesort` es propio; los costos de tabla son propios). En el plan, `table_name` es el **alias** si la consulta lo usa. MySQL: `EXPLAIN FORMAT=TREE` / `EXPLAIN ANALYZE` (texto, costo acumulado, `actual time=a..b` por bucle). Con `UPDATE`/`DELETE` de una sola tabla ambos responden `<not executable by iterator executor>`: el estimado sale de `EXPLAIN FORMAT=JSON` con `explain_json_format_version = 1` (la versión 2, predeterminada desde 8.3, tampoco los describe) y el real no existe. En el JSON v1 las filas son `rows_examined_per_scan` y el costo propio `cost_info.read_cost + eval_cost` (`prefix_cost` acumula el orden del join).
- Tablas MyISAM/Aria no se pueden revertir: antes de medir una escritura se consulta `information_schema.ENGINES.TRANSACTIONS`.

## SQLite (`node:sqlite`)
- Cada sesión es un `worker_thread` (el driver es síncrono). El código del hilo se pasa como texto: no puede usar imports ni constantes del módulo.
- Cancelar termina el hilo: se pierde la transacción abierta y la siguiente ejecución abre otro.
- `node:sqlite` no acepta booleanos como parámetro.
- `INTEGER PRIMARY KEY` es el rowid: nunca nulo y sin índice propio.
- Sin esquemas por sesión (`main` y bases adjuntas). CHECK no se listan aparte (están en el DDL).
- Planes: solo `EXPLAIN QUERY PLAN` (`id, parent, notused, detail`), sin costos ni filas. No hay plan real.

## SQL Server (`tedious`)
- `tedious` convierte decimal/money a `Number` y fechas a `Date` (pierde precisión): `exact-values.ts` envuelve `valueParser.readValue` para leerlos como texto, sin parchear `node_modules`.
- Cada sentencia va como lote (`execSqlBatch`) para conservar `#temp` y variables. Con parámetros, `sp_executesql`; pero un `BEGIN TRANSACTION` dentro de `sp_executesql` no sobrevive al cerrar el procedimiento: control de transacciones siempre como lote.
- Modo manual con `IF @@TRANCOUNT = 0 BEGIN TRANSACTION`; **no** `IMPLICIT_TRANSACTIONS`, que anida el `BEGIN TRANSACTION` del usuario.
- El esquema predeterminado es del usuario, no de la sesión: calificar los nombres.
- Mensajes 5701/5703 (cambio de base o idioma) son ruido: se filtran.
- El primer resultado se describe con `sys.dm_exec_describe_first_result_set` en la conexión de metadatos (tabla de origen y PK).
- Planes: `SET SHOWPLAN_XML ON` (no ejecuta) o `SET STATISTICS XML ON` (ejecuta), cada `SET` en su propio lote. El XML llega como resultado de una columna llamada `Microsoft SQL Server 2005 XML Showplan`. `TableCardinality` da las filas de la tabla en un *Clustered Index Scan*. En modo fila `ActualElapsedms` incluye a los hijos; en modo lote es del operador.
- Para leer desde otra sesión mientras una prueba tiene una transacción abierta, la base de pruebas usa `ALLOW_SNAPSHOT_ISOLATION`.
