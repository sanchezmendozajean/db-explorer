# Conexiones

Una conexión guarda los datos para llegar a una base de datos. Las conexiones viven en la vista **Conexiones** de la barra lateral.

## Crear una conexión

Pulsa <span class="ui">Nueva conexión</span> (el botón <span class="ui">+</span> de la cabecera de la vista). Primero eliges el motor (PostgreSQL, MariaDB / MySQL, SQLite o SQL Server) y luego completas el formulario.

### General

| Campo | Qué es |
| --- | --- |
| Nombre | Cómo se ve en el árbol. |
| Carpeta | Para agrupar conexiones. |
| Entorno | Local, Desarrollo, QA o Producción. Define el color y las protecciones. |
| Color personalizado | Opcional; reemplaza el color del entorno. |

### Servidor (PostgreSQL, MariaDB/MySQL y SQL Server)

- **Host** y **Puerto**. Los valores por defecto son 5432 (PostgreSQL), 3306 (MariaDB/MySQL) y 1433 (SQL Server).
- **Base de datos** (opcional): si la dejas vacía, ves todas las bases del servidor.
- **Usuario** y **Contraseña**. Marca <span class="ui">Guardar contraseña</span> si quieres que se recuerde; si no, se pide al conectar y solo se mantiene en memoria mientras dure la sesión.
- **Instancia** (solo SQL Server, opcional).

### SQLite

- **Ruta del archivo**, con el botón <span class="ui">Examinar…</span>.
- <span class="ui">Solo lectura</span> abre el archivo sin permitir cambios.
- <span class="ui">Crear si no existe</span> crea la base vacía en esa ruta.

### SSL/TLS

Una sección colapsable con el modo (**Desactivado**, **Requerido**, **Verificar CA** o **Verificar completo**) y el certificado de la CA. En SQL Server también están <span class="ui">Cifrar</span> y <span class="ui">Confiar en el certificado del servidor</span>.

### Avanzado

- **Solo lectura**: bloquea las sentencias que modifican datos o estructura.
- **Confirmar sentencias de escritura**: pide confirmación antes de ejecutarlas. Se activa solo en Producción.
- **Tiempo de espera de conexión** (15 segundos por defecto) y **de consulta** (sin límite por defecto).
- **Parámetros extra** en formato `clave=valor`.
- **Mostrar objetos del sistema**.

## Probar la conexión

El botón <span class="ui">Probar conexión</span> intenta conectarse sin guardar y muestra el resultado junto al botón, por ejemplo «Conectado — PostgreSQL 16.2 (42 ms)», o el mensaje de error del motor.

## Conectar y desconectar

- **Doble clic** en la conexión la conecta y la expande.
- El punto de color junto al nombre está **hueco** si la conexión está desconectada y **relleno** si está conectada. Mientras conecta se muestra un indicador de carga, y si falla, un ícono de error con el mensaje en el *tooltip*.
- Desde el menú contextual: <span class="ui">Conectar</span> / <span class="ui">Desconectar</span>.

## Organizar

Menú contextual de una conexión (clic derecho):

- **Nuevo script SQL** (<kbd>Ctrl</kbd>+<kbd>]</kbd>)
- **Editar conexión…** (<kbd>F4</kbd>), **Duplicar**, **Renombrar** (<kbd>F2</kbd>)
- **Mover a carpeta**, **Eliminar** (<kbd>Supr</kbd>, con confirmación)
- **Refrescar** y **Copiar nombre**

La cabecera de la vista también tiene <span class="ui">Nueva carpeta</span>, <span class="ui">Refrescar</span> y <span class="ui">Colapsar todo</span>. El menú <span class="ui">⋯</span> permite filtrar por entorno y mostrar los objetos del sistema.

## Contraseñas guardadas

Las contraseñas se cifran con el sistema (DPAPI de tu usuario de Windows) y se guardan en un archivo aparte. Al editar una conexión ves `••••••••` y solo se envía una contraseña nueva si la cambias. Si el sistema no puede cifrar, la aplicación **no guarda contraseñas** y te lo avisa en el diálogo. Más en [Seguridad](./seguridad).

## Entornos y protección

El entorno no es solo un color: define cuánto te protege la aplicación.

| Protección | Cuándo se aplica |
| --- | --- |
| Confirmación antes de escribir | Si la conexión tiene activado *Confirmar sentencias de escritura* (por defecto en Producción). |
| Aviso de `UPDATE` / `DELETE` sin `WHERE` | Siempre, en cualquier entorno. |
| Bloqueo de escrituras | Si la conexión es de **solo lectura**. |

Los detalles están en [Seguridad](./seguridad).
