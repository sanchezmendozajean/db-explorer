# Seguridad

DB Explorer está pensado para usarse contra bases con datos sensibles. La seguridad es un requisito, no un extra.

## Qué sale de tu equipo

**Solo las conexiones a las bases de datos que tú configuras.** La aplicación no tiene telemetría ni hace llamadas de red por su cuenta.

## Contraseñas

- Se cifran con el **cifrado del sistema** (DPAPI de tu usuario de Windows) y se guardan en un archivo aparte. Nunca aparecen en los archivos de conexiones, de preferencias ni de estado, ni en los registros ni en los mensajes de error.
- La interfaz **nunca recibe** una contraseña guardada: el proceso principal la descifra y la entrega directamente al proceso que se conecta.
- Si no marcas <span class="ui">Guardar contraseña</span>, se pide al conectar y solo se mantiene en memoria durante la sesión.
- Si el sistema no puede cifrar, no se guardan contraseñas y el diálogo te lo avisa.
- Puedes **olvidar** todas las contraseñas guardadas desde Preferencias.

## Protección de entornos

Las sentencias se clasifican antes de ejecutarse:

| Categoría | Ejemplos |
| --- | --- |
| Lectura | `SELECT`, `WITH … SELECT`, `SHOW`, `DESCRIBE`, `EXPLAIN` |
| Escritura de datos | `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `REPLACE`, `TRUNCATE`, `COPY … FROM` |
| Estructura | `CREATE`, `ALTER`, `DROP`, `RENAME`, `GRANT`, `REVOKE` |
| Desconocidas | `CALL`, `EXEC` y bloques `DO` se tratan como escritura |

- **Confirmar escrituras**: si la conexión lo tiene activado (por defecto en Producción), aparece un modal con la sentencia y la conexión antes de ejecutar.
- **Sin `WHERE`**: un `UPDATE` o `DELETE` sin `WHERE` pide confirmación siempre, en cualquier entorno.
- **Solo lectura**: las sentencias que no son de lectura se bloquean en la aplicación y, cuando el motor lo permite, también en el servidor.

| Motor | Cómo se refuerza la solo lectura |
| --- | --- |
| PostgreSQL | Sesión en modo `READ ONLY` |
| MariaDB / MySQL | `SET SESSION TRANSACTION READ ONLY` |
| SQLite | El archivo se abre en modo de solo lectura |
| SQL Server | Solo el bloqueo de la aplicación; se recomienda usar un usuario con permisos de lectura |

La barra de estado y el borde de las pestañas se tiñen de rojo en Producción.

## Datos y registros

- Los **resultados** viven solo en memoria; nunca se guardan en disco.
- El **texto de las consultas** solo se guarda en el [historial](./historial), que puedes limpiar y desactivar.
- Los registros de la aplicación nunca incluyen contraseñas, cadenas de conexión completas ni datos de resultados.
- Los scripts son archivos `.sql` en tu carpeta de usuario. Si pegas datos en ellos, quedan en esos archivos.

## La propia aplicación

- La interfaz corre aislada del sistema: sin acceso directo a Node.js, con política de contenido estricta y sin navegación a páginas externas. Los enlaces externos solo abren direcciones `https:`.
- La API entre la interfaz y el proceso principal es mínima y todos sus mensajes se validan.
- El ejecutable se empaqueta con las protecciones de Electron activadas (por ejemplo, no puede usarse como Node.js).
- Las herramientas auxiliares de respaldo no van con la aplicación: las aportas tú, se verifican al importarlas y la contraseña nunca viaja en la línea de comandos.

::: tip Reportar un problema de seguridad
Si encuentras una vulnerabilidad, escríbela como [issue en GitHub](https://github.com/sanchezmendozajean/db-explorer/issues) sin incluir datos sensibles, o contacta al autor por su perfil.
:::
