# Administrar bases de datos

Desde el árbol puedes **crear, renombrar, eliminar, respaldar y restaurar** bases de datos en PostgreSQL, MariaDB/MySQL y SQL Server. En SQLite no aplica: el archivo *es* la conexión.

## Dónde está

- **Crear**: menú contextual de la conexión.
- **Respaldar, Restaurar, Renombrar y Eliminar**: menú contextual de la base. <kbd>F2</kbd> renombra y <kbd>Supr</kbd> elimina.

**Renombrar** no está disponible en MariaDB/MySQL (no tienen soporte nativo y la aplicación no lo simula). En PostgreSQL y SQL Server, si la conexión es de **Producción**, antes de aplicar se muestra el SQL que se va a ejecutar y hay que confirmarlo.

Las conexiones de **solo lectura** no pueden crear, eliminar, renombrar ni restaurar.

## Respaldar y restaurar

| Motor | Cómo respalda | Formato |
| --- | --- | --- |
| PostgreSQL | `pg_dump` | Archivo `.backup` (formato personalizado) |
| MariaDB / MySQL | `mariadb-dump` / `mysqldump` | Script `.sql` con rutinas, triggers y eventos |
| SQL Server | `BACKUP DATABASE` en el propio servidor | Archivo `.bak` **en el servidor** |

### Herramientas auxiliares (PostgreSQL y MariaDB/MySQL)

Las herramientas de línea de comandos **no se distribuyen** con DB Explorer por sus licencias. La primera vez que respaldas, un modal te pide adjuntarlas: arrástralas o elígelas con el selector. Se copian a la carpeta de datos de la aplicación y no tienes que repetirlo.

Antes de aceptarlas se comprueba que sean las herramientas esperadas. MariaDB y MySQL son familias separadas, así que cada una usa las suyas.

### Restaurar

Pide confirmar el reemplazo antes de empezar.

- **PostgreSQL** restaura con `pg_restore` en una sola transacción (si algo falla, no queda a medias). Solo acepta el formato personalizado, no `.sql` plano.
- **MariaDB / MySQL** ejecuta el script: reemplaza las tablas que contiene y conserva lo que exista y no esté en el respaldo.
- **SQL Server** usa `RESTORE … WITH REPLACE`.

### Detalles a tener en cuenta

- En **SQL Server la ruta es la del servidor**, no la de tu equipo, y la cuenta de servicio de SQL Server necesita permisos sobre ella. Esta operación no se puede cancelar.
- Las operaciones con herramientas externas sí se pueden cancelar con el botón <span class="ui">Cancelar operación</span>, que termina el proceso y borra el archivo a medias.
- La contraseña nunca viaja en la línea de comandos ni queda en archivos temporales.

::: warning Cuidado
Restaurar reemplaza datos. Hazlo primero en una copia si no estás seguro.
:::
