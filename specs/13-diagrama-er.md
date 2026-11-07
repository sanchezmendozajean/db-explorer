# 13 — Diagrama ER

Muestra las **tablas de un esquema y sus relaciones** (claves foráneas) como un diagrama físico: cada tabla es una caja con sus columnas y cada clave foránea, una línea entre cajas. Es de **solo lectura**: no edita el esquema (el diseñador visual de tablas sigue fuera de alcance, ver `01`). Se construye en el hito M10 (`09`).

## 1. Comandos y apertura

| Comando | Dónde | Qué hace |
|---|---|---|
| `db.openDiagram` — **Ver diagrama** | Menú contextual de un esquema (o de la base, en MariaDB/MySQL y SQLite) en el árbol, y paleta de comandos | Abre una pestaña de diagrama con todas las tablas de ese esquema. |
| **Ver diagrama** en una tabla | Menú contextual de una tabla | Abre el diagrama de su esquema con esa tabla seleccionada y centrada. |

- Es una pestaña nueva de tipo `diagram` (junto a `script`, `object`, `routine` y `preferences`). Una pestaña por esquema: si ya está abierta, se enfoca.
- Usa la **conexión de metadatos** (la del árbol), no la sesión de un editor.
- Solo tablas; las vistas no se dibujan (no tienen claves foráneas).

## 2. Datos que necesita

### 2.1 Contrato
Se agrega una consulta masiva al db-host, porque pedir `TableDetails` tabla por tabla es lento en esquemas grandes:

```ts
interface DiagramTable {
  name: string;
  columns: { name: string; nativeType: string; nullable: boolean; primaryKey: boolean }[];
}
interface DiagramRelation {
  name: string;
  /** Tabla que contiene la clave foránea. */
  from: { schema: string; table: string; columns: string[] };
  /** Tabla referenciada. Puede estar en otro esquema o base. */
  to: { schema: string; table: string; columns: string[] };
}
interface SchemaDiagram {
  tables: DiagramTable[];
  relations: DiagramRelation[];
}
```

- Una sola consulta de columnas y una de claves foráneas por esquema, en cada driver (`getSchemaDiagram`).
- `ConstraintInfo` (`metadata.ts`) gana un campo opcional `references?: { schema: string; table: string; columns: string[] }` para las claves foráneas, de modo que la pestaña Estructura y el diagrama compartan el mismo dato. `definition` se conserva para mostrar.
- Fuentes por motor: PostgreSQL, `pg_constraint` (`conrelid`, `confrelid`, `conkey`, `confkey`; hoy el driver usa `pg_get_constraintdef`, que solo da texto); MariaDB/MySQL, `information_schema.KEY_COLUMN_USAGE`; SQL Server, `sys.foreign_keys` y `sys.foreign_key_columns`; SQLite, `pragma_foreign_key_list`. Los tres últimos ya se consultan para la pestaña Estructura.
- Una relación hacia una tabla fuera del esquema abierto se dibuja como **caja externa atenuada** con solo su nombre completo (sin columnas), sin cargar el otro esquema.

### 2.2 Límites
- Hasta **150 tablas** se dibujan completas. Con más, se avisa y se muestra un selector para elegir qué tablas incluir (por defecto, la tabla seleccionada y las relacionadas con ella a un nivel).
- Los textos de columnas muy largos se cortan con elipsis.

## 3. Dibujo (SVG propio, sin dependencias nuevas)

- Todo es SVG en React. No se agrega ninguna librería de diagramas ni de disposición.
- **Caja de tabla**: cabecera con el nombre (fondo `bg.sidebar`, texto `fg`), y una fila por columna con icono de clave (PK) o de enlace (FK), nombre y tipo (`fg.muted`). Colores y tipografía de los tokens de `04` §2 y §3, claro y oscuro.
- **Relación**: línea ortogonal (segmentos horizontales y verticales) desde la columna FK hasta la columna referenciada, con marca de "muchos" en el lado de la FK (pata de gallo) y "uno" en el lado referenciado. Si la FK admite `NULL`, línea con el extremo opcional vacío; si no, lleno. Al pasar el cursor sobre una línea o una caja, se resalta con sus relaciones y se atenúa el resto. Tooltip con el nombre de la restricción.
- Las líneas salen del lado izquierdo o derecho de la caja, el que quede más cerca de la otra.

## 4. Disposición inicial

Automática y simple, sin librerías:

1. Las tablas se ordenan por componentes conectados (grupos de tablas relacionadas) y, dentro de cada uno, por capas: una tabla va a la derecha de las que referencia (BFS desde las tablas sin claves foráneas salientes).
2. Cada capa es una columna; las tablas de una capa se apilan con un margen fijo.
3. Los componentes se colocan uno debajo de otro; las tablas sin relaciones, en una cuadrícula al final.

Es determinista: el mismo esquema produce la misma disposición.

## 5. Interacción

- **Mover cajas**: se arrastra una caja por su cabecera (ratón, con captura del puntero). Las líneas conectadas la siguen en vivo y se recalculan al soltar.
- **Desplazar el lienzo**: arrastrar el fondo, o rueda con Mayús para horizontal.
- **Zoom**: Ctrl + rueda sobre el cursor, y botones **+ / − / Ajustar** (ver todo) en una barra pequeña de la pestaña. Rango de 25 % a 200 %.
- **Seleccionar** una caja: clic. Doble clic abre la pestaña de objeto de la tabla.
- **Reorganizar**: botón que descarta las posiciones manuales y vuelve a la disposición automática.
- **Teclado**: las cajas son enfocables con Tab; las flechas las mueven 10 px (Mayús: 50 px); Enter abre la tabla. Los botones de zoom tienen atajos Ctrl+`+`, Ctrl+`-` y Ctrl+0 solo con el diagrama enfocado.
- **Recordar posiciones**: las posiciones movidas a mano se guardan por conexión + base + esquema en el estado de la interfaz (`ui-state.json`), sin datos de las tablas. Al reabrir, las tablas con posición guardada la conservan y las nuevas se colocan con la disposición automática. Si una tabla ya no existe, su posición se descarta.
- **Exportar a SVG**: botón y comando que guardan el diagrama completo (no solo lo visible) como archivo `.svg` con colores del tema actual y texto como texto.
  - El archivo se crea **en la raíz del espacio de trabajo** (`11`, D16/D17: por defecto `Documentos\DB Explorer`), sin diálogo, como los scripts nuevos. Nombre `Diagrama-<esquema>.svg`; si existe, `Diagrama-<esquema>-2.svg`, etc. (nunca se sobrescribe). Los caracteres no válidos en Windows se reemplazan por `_`.
  - Aparece al instante en la vista Archivos (el vigilante del espacio de trabajo lo detecta) y se muestra una notificación "Diagrama guardado en <nombre>" con la acción **Mostrar en Archivos**.
  - Se escribe de forma atómica, igual que los demás archivos del espacio. Si el espacio de trabajo no está disponible, se avisa con el error y no se guarda en otro lugar.
  - Sin red.

## 6. Estados

- Cargando: indicador de progreso en la pestaña.
- Esquema sin tablas: "Este esquema no tiene tablas".
- Esquema con tablas pero sin relaciones: se dibujan las cajas en cuadrícula y un aviso discreto "No hay claves foráneas en este esquema".
- Error de conexión o permisos: mensaje con el error del motor y botón Reintentar.
- La pestaña no se actualiza sola si el esquema cambia: botón **Actualizar** (conserva las posiciones).

## 7. Fuera de alcance de este hito

- Editar tablas, columnas o relaciones desde el diagrama; generar DDL a partir de él.
- Diagramas que mezclen varios esquemas o bases; diagrama lógico (sin tipos); notas y agrupaciones.
- Exportar a PNG o PDF (se puede imprimir o convertir el SVG).
- Relaciones inferidas por nombre cuando no hay clave foránea declarada.

## 8. Pruebas

- **Unitarias**: disposición (determinista, capas, componentes, cuadrícula), enrutado de líneas, recorte de textos, descarte de posiciones obsoletas.
- **Integración en los cuatro motores**: `getSchemaDiagram` devuelve tablas, columnas, PK y FK (incluida una FK compuesta y una FK hacia otro esquema donde el motor lo permita).
- **e2e (Playwright)**: abrir el diagrama desde el árbol; arrastrar una caja y comprobar que las líneas la siguen; zoom; reiniciar la app y verificar que la posición se recordó; exportar SVG y comprobar que el archivo queda en la raíz del espacio de trabajo, aparece en la vista Archivos y contiene todas las tablas; exportar dos veces crea `Diagrama-<esquema>-2.svg` sin sobrescribir.

## 9. Archivo de diagrama (`.dbxdiagram`)

El diagrama se puede guardar **en el espacio de trabajo** como un archivo propio de DB Explorer, que se vuelve a dibujar sin consultar la base.

- **Formato**: JSON con sangría (`shared/diagram-file.ts`): `format` (`dbexplorer-diagram`), `version` (1), `savedAt`, `connection` (`id`, `name`, `engine`), `database`, `schema`, `tables`, `relations` y `positions` (las cajas movidas a mano). Solo estructura: nunca contraseñas ni datos de las tablas.
- **Se guarda al abrir**, como un script nuevo: en cuanto el diagrama carga, se crea `Diagrama-<conexión>.dbxdiagram` en la raíz del espacio de trabajo (sin sobrescribir otro: `-2`, `-3`…) y aparece en Archivos sin avisos. La pestaña pasa a llamarse como el archivo. No hay botón de guardar.
- **Reabrir**: *Ver diagrama* busca primero en el espacio de trabajo un archivo de ese esquema de esa conexión (por `id` o por nombre y motor) y, si existe, lo reabre en vez de crear otro; si la conexión está abierta lo pone al día desde la base en segundo plano (sin pedir contraseñas ni mostrar un diagrama en blanco; si falla, queda la copia guardada).
- **Guardado automático**: mover cajas, *Reorganizar* y *Actualizar* reescriben el archivo solos (600 ms después del último cambio, y al cerrar la pestaña). **Ctrl+S** guarda al instante y avisa. Las posiciones viven en el archivo y no en `ui-state.json`.
- **Abrir**: clic o doble clic en el archivo desde Archivos, Ctrl+O o Ctrl+P. Se valida antes de abrir; si está dañado o es de una versión más nueva, avisa con el motivo y no abre nada.
- **Sin conexión**: la conexión se busca por `id` y, si no está, por nombre y motor. Si no existe, el diagrama se muestra igual desde la copia guardada (etiqueta *Copia guardada*), sin *Actualizar* ni abrir tablas. *Exportar a SVG* sigue funcionando.
- La exportación a SVG (§5) se mantiene aparte, para compartir o imprimir.
- Las pestañas de diagrama no se restauran al reiniciar la aplicación (como las de objeto).
