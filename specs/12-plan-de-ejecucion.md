# 12 — Plan de ejecución

Muestra **cómo el motor piensa ejecutar una consulta** (estimado, sin ejecutarla) o **cómo la ejecutó** (real, con filas y tiempos medidos), en una vista común para los cuatro motores. Se construye en el hito M8 (`09`).

## 1. Comandos

| Comando | Atajo | Qué hace |
|---|---|---|
| `db.explainPlan` — **Explicar plan** | **Ctrl+Alt+E** | Pide el plan **estimado**. No ejecuta la sentencia. |
| `db.explainAnalyze` — **Explicar y ejecutar** | **Ctrl+Alt+Shift+E** | **Ejecuta** la sentencia y devuelve el plan con valores **reales**. Si la sentencia modifica datos, se ejecuta dentro de una transacción que **siempre se revierte** (§4). |

- Ubicación: menú **Consulta** (después de Modo auto-commit), menú contextual del editor (bajo Ejecutar selección), paleta de comandos y botón `codicon-lightbulb` de la barra del editor (ejecuta *Explicar plan*; su tooltip menciona ambos atajos).
- Opera sobre **una sola sentencia**: la selección o la sentencia bajo el cursor (mismas reglas de `05`, incluido el separador de sentencias). Si la selección contiene varias, se avisa "Selecciona una sola sentencia para ver su plan" y no se ejecuta nada.
- Usa la **sesión de la pestaña** (misma conexión, base, esquema y transacción): ve las tablas temporales y los cambios no confirmados de la pestaña.
- Se cancela igual que una ejecución (Ctrl+Shift+Q, botón Cancelar), con el mismo cronómetro y barra de progreso.
- Si el motor no puede explicar la sentencia (p. ej. `CREATE TABLE`), el error del motor se muestra en **Mensajes** como cualquier error de ejecución.

## 2. Cómo se obtiene en cada motor

El DB Host agrega `explain(sql, { analyze })` a `DbSession`. Cada driver pide el plan en el formato más rico disponible y lo convierte al modelo común (§3). El parser de cada motor vive junto a su driver (`drivers/<motor>/plan.ts`) y es una función pura con tests sobre planes reales guardados como fixtures.

| Motor | Estimado | Real | Formato que se interpreta |
|---|---|---|---|
| PostgreSQL | `EXPLAIN (FORMAT JSON, VERBOSE) …` | `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON, VERBOSE) …` | JSON |
| MariaDB | `EXPLAIN FORMAT=JSON …` | `ANALYZE FORMAT=JSON …` | JSON |
| MySQL 8 (**por completar**, ver `NOTAS.md` §MySQL) | `EXPLAIN FORMAT=TREE …` | `EXPLAIN ANALYZE …` | Texto en árbol (`-> Operación (cost=… rows=…) (actual time=… rows=… loops=…)`) |
| SQLite | `EXPLAIN QUERY PLAN …` | **No disponible** (SQLite no entrega filas ni tiempos reales por paso): el comando se deshabilita con tooltip explicando por qué | Filas `id, parent, detail` |
| SQL Server | `SET SHOWPLAN_XML ON` + sentencia + `SET SHOWPLAN_XML OFF` | `SET STATISTICS XML ON` + sentencia + `SET STATISTICS XML OFF` | XML de showplan (`RelOp`) |

- Para el XML de SQL Server se agrega la dependencia `fast-xml-parser` (pura JS, sin red).
- El texto original que devolvió el motor (JSON, texto o XML) se conserva tal cual para **Ver original** (§5).
- Lo que el motor no entrega queda vacío y su columna se oculta (SQLite no tiene costos; los planes estimados no tienen valores reales).

## 3. Modelo común

```ts
interface ExecutionPlan {
  engine: Engine;
  analyzed: boolean;          // true = valores reales
  statement: string;          // la sentencia explicada
  planningMs?: number;
  executionMs?: number;
  totalCost?: number;         // costo del nodo raíz (unidades del motor)
  roots: PlanNode[];          // normalmente uno; SQL Server puede devolver varios
  raw: string;                // respuesta original del motor
  rawLanguage: 'json' | 'xml' | 'plaintext';
}

interface PlanNode {
  id: string;
  operation: string;          // "Seq Scan", "Hash Join", "Clustered Index Seek"…
  object?: string;            // tabla o índice
  alias?: string;             // alias en la consulta, si difiere del nombre (en fg.muted)
  condition?: string;         // filtro, condición de join o de índice (una línea)
  totalCost?: number;         // costo acumulado del subárbol
  selfCost?: number;          // costo propio = total − suma de hijos (calculado)
  estimatedRows?: number;
  actualRows?: number;        // por bucle × bucles (total real)
  loops?: number;
  actualTimeMs?: number;      // tiempo propio (se resta el de los hijos)
  warnings: PlanWarning[];
  properties: { group: 'general' | 'estimated' | 'actual'; label: string; value: string }[];  // todo lo demás, para el panel de detalle
  children: PlanNode[];
}

type PlanWarning =
  | { kind: 'fullScan'; rows: number }
  | { kind: 'misestimate'; estimated: number; actual: number }
  | { kind: 'spill' }                    // ordenamiento o hash que usó disco
  | { kind: 'engine'; message: string }; // avisos propios del motor (índice faltante, conversión implícita…)
```

### Avisos (umbrales fijos, sin configuración)
- **Recorrido completo** (`fullScan`): lectura secuencial de una tabla (no de una tabla temporal ni de un CTE) con 10 000 filas estimadas o más.
- **Estimación errada** (`misestimate`): solo con valores reales; filas reales y estimadas difieren 10 veces o más y alguna de las dos supera 100.
- **Uso de disco** (`spill`): Postgres `Sort Method: external …` o `Batches > 1` en Hash; SQL Server `SpillToTempDb`; MariaDB `filesort` con `r_used_priority_queue: false` y archivos temporales.
- **Del motor** (`engine`): SQL Server `Warnings` y `MissingIndexes`; MariaDB/MySQL `Using temporary`, `Using filesort` sobre tablas grandes.

## 4. Seguridad (complementa `08` §Protección de entornos)

- **Explicar plan** cuenta como **lectura** sea cual sea la sentencia: no la ejecuta. Se permite en conexiones de solo lectura y en Producción sin confirmación.
- **Explicar y ejecutar** cuenta como la sentencia que explica:
  - Lectura → sin confirmación.
  - Escritura de datos → se ejecuta dentro de una transacción y **siempre se revierte**: `BEGIN` … `ROLLBACK`, o `SAVEPOINT` … `ROLLBACK TO SAVEPOINT` si la pestaña ya tiene una transacción abierta en modo manual (M7). Aun así se aplican las reglas de `08`: bloqueada en conexiones de solo lectura; modal de confirmación en Producción; aviso de `UPDATE`/`DELETE` sin `WHERE`. El modal agrega el texto "La sentencia se ejecutará para medir el plan y luego se revertirá".
  - MariaDB/MySQL con tablas no transaccionales (MyISAM, Aria) no pueden revertirse: si la sentencia de escritura toca una de ellas, se bloquea con el mensaje "La tabla X no admite transacciones; no se puede ejecutar y revertir".
  - Estructura (`CREATE`, `ALTER`, `DROP`…) → no se permite: "Explicar y ejecutar no está disponible para sentencias de estructura".
- El plan puede contener valores literales de la consulta: se trata como **dato de resultado** (no se registra en logs; sí en el historial como cualquier ejecución, marcada como "Plan").

## 5. Interfaz: pestaña **Plan** del panel de resultados

Aparece a la derecha de las pestañas de resultado, antes de **Mensajes**, con icono `codicon-lightbulb` y el texto **Plan** (o **Plan (real)** si se ejecutó). Hay una sola por pestaña de editor: el siguiente plan la reemplaza. Ejecutar una consulta normal no la quita (conviven con los resultados); se cierra con su `codicon-close`.

### Barra (30 px)
- Chip **Estimado** (`fg.muted`) o **Real** (`accent`).
- Resumen: "Costo total 247,6 · Planificación 0,4 ms · Ejecución 12,3 ms" (lo que el motor entregue).
- Contador de avisos `codicon-warning` "2 avisos" (en `warning`); clic salta al primero, clic de nuevo al siguiente.
- A la derecha: `codicon-expand-all` Expandir todo, `codicon-collapse-all` Contraer todo, `codicon-code` **Ver original** (alterna entre el árbol y el texto original en Monaco de solo lectura con resaltado `json`/`xml`), `codicon-copy` Copiar original, `codicon-refresh` Volver a explicar.

### Árbol-tabla
Filas de 22 px con sangría por nivel (12 px) y chevrons como el árbol de conexiones; virtualizado (los planes de SQL Server pueden tener cientos de nodos).

| Columna | Contenido |
|---|---|
| Operación | Icono por familia (`codicon-table` lectura de tabla, `codicon-key` índice, `codicon-merge` join, `codicon-list-ordered` orden, `codicon-symbol-operator` agregación, `codicon-circle-outline` otros) + nombre. `codicon-warning` en `warning` si el nodo tiene avisos (tooltip con el texto). |
| Objeto | Tabla o índice (`fg.muted` el alias). |
| Costo | Barra horizontal de 60 px con el % del costo **propio** sobre el total + número. Barra en `accent`; en `warning` si supera el 50 % del total. |
| Filas est. | Número con separador de miles. |
| Filas reales | Solo en planes reales. En `warning` si hay `misestimate`. |
| Bucles | Solo en planes reales y si algún nodo tiene más de 1. |
| Tiempo | Solo en planes reales: tiempo propio en ms + barra igual a la de costo. |

- Columnas redimensionables; la condición (filtro o join) se muestra como segunda línea `fg.muted` en itálica bajo la operación cuando existe (fila de 36 px).
- Teclado: ↑/↓ mover, →/← expandir/contraer, Enter abre el detalle, Ctrl+C copia la fila como texto (`Operación · Objeto · Costo · Filas`).
- Por defecto todo expandido.

### Panel de detalle
Panel lateral derecho de 300 px (redimensionable, mismo patrón que el visor de valor de `04` §10), visible al seleccionar un nodo; se cierra con Esc o su `codicon-close`. Lista **propiedad: valor** con todo lo que el motor informó del nodo (condiciones completas, índice, columnas de salida, memoria, búferes, avisos con su explicación), agrupado en *General*, *Estimado*, *Real* y *Avisos*. Valores largos (SQL, listas de columnas) en `font-mono` con ajuste de línea.

### Estados
- Durante la petición: la pestaña Plan muestra la barra de progreso y "Obteniendo plan…".
- Error: se muestra en Mensajes y la pestaña Plan no se crea (o conserva la anterior).

## 6. Fuera del alcance (v1)
- Diagrama gráfico de cajas y flechas (posible v2, reutilizando el mismo modelo).
- Comparar dos planes.
- Sugerencias automáticas de índices propias (solo se muestran las que entrega SQL Server).

## 7. Tests
- **Unitarios**: un parser por formato (Postgres JSON, MariaDB JSON, MySQL TREE, SQLite, SQL Server XML) con fixtures de planes reales estimados y medidos; cálculo de costo y tiempo propios; reglas de avisos.
- **Integración** (los cuatro motores, suite común de `03`): explicar un `JOIN` con filtro devuelve un árbol con la tabla de cada lado; *Explicar y ejecutar* de un `DELETE` muestra filas reales y **la tabla conserva sus filas** (Postgres, MariaDB, SQL Server); en SQLite *Explicar y ejecutar* informa no disponible.
- **e2e**: Ctrl+Alt+E abre la pestaña Plan con el árbol; seleccionar un nodo abre el detalle; Ver original muestra el JSON; en una conexión de Producción, Ctrl+Alt+Shift+E sobre un `UPDATE` pide confirmación y después de aceptar los datos no cambian.
