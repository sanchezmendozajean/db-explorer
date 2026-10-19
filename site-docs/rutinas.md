# Procedimientos y funciones

Disponible en SQL Server, PostgreSQL y MariaDB/MySQL.

## Abrir una rutina

Haz doble clic en un procedimiento o una función del árbol. Se abre una pestaña con su **definición** en el editor, con las mismas ayudas que un script: autocompletado y *hover* con el catálogo de su conexión, y formateo.

En PostgreSQL, el autocompletado también funciona dentro del cuerpo `$$ … $$`.

## Guardar los cambios

<kbd>Ctrl</kbd>+<kbd>S</kbd> pregunta y aplica la definición en la base de datos:

| Motor | Cómo se aplica |
| --- | --- |
| SQL Server | `ALTER` |
| PostgreSQL | `CREATE OR REPLACE` |
| MariaDB / MySQL | `DROP` y `CREATE`, con restauración de la versión anterior si algo falla |

Si el motor devuelve un error, se marca la posición en el texto y se muestra el mensaje. En conexiones de **solo lectura**, o con confirmación de escritura activada, se aplican las mismas protecciones que en cualquier otra escritura.
