# Tablas y vistas

Al hacer doble clic en una tabla o vista se abre una **pestaña de objeto** con tres subpestañas.

## Datos

Muestra el contenido de la tabla en la misma grilla de los [resultados](./resultados).

- Arriba hay dos campos de una línea: **WHERE** y **ORDER BY**. Escribes solo la condición o el orden, con autocompletado de columnas, y la consulta se vuelve a ejecutar.
- Como la tabla es conocida, la grilla **es editable**; si la tabla no tiene clave, se identifica cada fila por todos sus valores y se advierte. Ver [Editar datos](./edicion).
- Si el resultado está truncado, puedes ordenar en el servidor para no depender de las filas ya cargadas.

## Estructura

Tres tablas simples:

- **Columnas**: número, nombre, tipo, si admite nulos, valor por defecto, si es clave primaria y comentario.
- **Índices**.
- **Claves y restricciones**: clave primaria, únicas, foráneas y `CHECK`.

## DDL

El `CREATE TABLE` de la tabla, en un editor de solo lectura, con sus índices y comentarios. El botón <span class="ui">Abrir en script</span> lo copia a un script nuevo para que lo modifiques.

::: info Según el motor
PostgreSQL y SQL Server arman el DDL desde el catálogo; MariaDB/MySQL usan `SHOW CREATE`; SQLite muestra el SQL original guardado en la base.
:::

## Atajos útiles

- <kbd>F12</kbd> con el cursor sobre una tabla en el editor abre su pestaña de objeto.
- Al pasar el cursor sobre el nombre de una tabla se muestra una descripción con sus columnas.
- Las pestañas de objeto se restauran al abrir la aplicación sin conectar; se conectan al enfocarlas.
