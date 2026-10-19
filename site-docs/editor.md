# El editor SQL

Cada script se edita con **Monaco**, el mismo editor de VS Code. Todo lo que ya sabes de VS Code funciona aquí.

## Lo que hereda de VS Code

- **Multicursor**: <kbd>Ctrl</kbd>+<kbd>D</kbd> (siguiente coincidencia), <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> (todas), <kbd>Alt</kbd>+clic y selección en bloque.
- **Líneas**: mover (<kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd>), copiar (<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd>), borrar (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd>).
- **Comentarios**: línea con <kbd>Ctrl</kbd>+<kbd>/</kbd> y bloque con <kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd>.
- **Buscar y reemplazar** con <kbd>Ctrl</kbd>+<kbd>F</kbd> / <kbd>Ctrl</kbd>+<kbd>H</kbd>, **ir a línea** con <kbd>Ctrl</kbd>+<kbd>G</kbd>, **plegado** de bloques y **expandir selección**.
- Transformar a mayúsculas o minúsculas con <kbd>Ctrl</kbd>+<kbd>K</kbd> <kbd>Ctrl</kbd>+<kbd>U</kbd> / <kbd>Ctrl</kbd>+<kbd>L</kbd>.

## Resaltado según el motor

El lenguaje del editor cambia según la conexión de la pestaña: PostgreSQL, MySQL/MariaDB, T-SQL (SQL Server) o SQLite. Un `.sql` sin conexión asociada usa SQL genérico.

## Autocompletado

Se alimenta del **catálogo real** de tu conexión, que se carga en segundo plano al conectar o al cambiar de esquema. Entiende el contexto de la sentencia:

| Dónde | Qué sugiere |
| --- | --- |
| Después de `FROM`, `JOIN`, `UPDATE`, `INTO` | Tablas y vistas (y esquemas, que insertan `esquema.`) |
| Después de `esquema.` | Los objetos de ese esquema |
| Después de `alias.` o `tabla.` | Las columnas de esa tabla, resolviendo los alias declarados (`FROM clientes c`, `JOIN pedidos AS p`) |
| En `SELECT`, `WHERE`, `ON`, `GROUP BY`, `ORDER BY`, `SET` | Columnas de las tablas de la sentencia, funciones y palabras clave |

Además:

- Entiende **CTE** (`WITH …`), **subconsultas** y **rutinas**.
- **Entrecomilla** automáticamente cuando hace falta (mayúsculas en PostgreSQL, espacios, palabras reservadas) con el carácter del motor: `"…"`, `` `…` `` o `[…]`.
- Cada sugerencia muestra el tipo de la columna, si es clave primaria y su tabla de origen.
- **Snippets**: `sel` → `SELECT * FROM …`; también `ins`, `upd`, `del` (con `WHERE`) y `cte`.

<kbd>Ctrl</kbd>+<kbd>Espacio</kbd> abre las sugerencias a mano.

## Hover, definición y errores

- Pasa el cursor sobre una tabla para ver sus **columnas con tipos**, o sobre una columna para ver su tipo, si admite nulos y su valor por defecto.
- <kbd>F12</kbd> sobre una tabla o vista abre su [pestaña de objeto](./objetos).
- Los errores que devuelve el motor se **marcan en la posición** indicada.

## Formatear

<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd> formatea el script, o solo la selección si la hay, con el dialecto de la conexión.

## Sentencia activa

La sentencia que se ejecutaría con <kbd>Ctrl</kbd>+<kbd>Enter</kbd> se destaca con un fondo sutil y una barra de color en el margen izquierdo. Cambia mientras mueves el cursor. Si el cursor está en una línea vacía entre dos sentencias, se toma la anterior.

### Separador de sentencias

Por defecto las sentencias se separan con `;`. En el menú <span class="ui">Consulta › Separador de sentencias</span> puedes elegir **Línea en blanco**: entonces una línea vacía también separa sentencias. Las líneas vacías dentro de cadenas, comentarios de bloque o cuerpos de rutina no cuentan.

::: info Solo para Ejecutar sentencia
El separador de línea en blanco solo rige para <kbd>Ctrl</kbd>+<kbd>Enter</kbd>. Al ejecutar un script o una selección, solo el `;` separa sentencias (así un `WITH` con líneas en blanco entre sus CTE no se parte).
:::

## Menú contextual

Clic derecho en el editor abre el menú de la aplicación con las acciones de ejecución, el plan, el formateo y las acciones de edición.

## Atajos personalizables

Los atajos se guardan en un `keybindings.json` con el **formato de VS Code** y se pueden reasignar o quitar. Todos los comandos tienen un identificador `db.*` visible en la paleta. Ver [Atajos de teclado](./atajos#personalizar-los-atajos).
