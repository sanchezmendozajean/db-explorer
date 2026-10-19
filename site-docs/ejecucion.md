# Ejecutar consultas

## Elegir qué ejecutar

| Acción | Atajo | Qué ejecuta |
| --- | --- | --- |
| **Ejecutar sentencia** | <kbd>Ctrl</kbd>+<kbd>Enter</kbd> | La sentencia bajo el cursor. Con varias sentencias seleccionadas, las ejecuta una por una. |
| **Ejecutar script** | <kbd>Alt</kbd>+<kbd>X</kbd> o <kbd>F5</kbd> | Todo el script. Con una selección, solo esa selección como script. |
| **Ejecutar en una pestaña de resultado nueva** | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> | Mantiene los resultados anteriores. |
| **Cancelar** | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Q</kbd> o <kbd>Alt</kbd>+<kbd>Pausa</kbd> | Interrumpe la ejecución en curso. |

También están en el menú **Consulta** y en los botones de la barra del editor. Mientras se ejecuta, se ve un cronómetro y una barra de progreso.

Un script se envía **sentencia a sentencia, en orden y por la misma sesión**. Si una falla, la ejecución se detiene.

## Conexión, base y esquema de la pestaña

La barra del editor tiene selectores para la **conexión** y la **base de datos o esquema** activos de cada pestaña. Se cambian con <kbd>Ctrl</kbd>+<kbd>9</kbd> y <kbd>Ctrl</kbd>+<kbd>0</kbd>. Cada pestaña usa **su propia sesión**: las tablas temporales y las transacciones abiertas son de esa pestaña.

## Varios resultados

Cada sentencia que devuelve filas crea una pestaña **Resultado 1**, **Resultado 2**… El nombre se reemplaza por el de la tabla principal cuando se detecta. Puedes **fijar** un resultado con el ícono de la chincheta para que la siguiente ejecución no lo reemplace.

## Transacciones

La barra del editor muestra **Transacción: Auto** o **Manual**.

- **Auto** (por defecto): cada sentencia se confirma sola.
- **Manual**: se abre una transacción y los cambios quedan pendientes hasta que hagas **Commit** (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd>) o **Rollback** (<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd>). Volver a Auto confirma la transacción abierta.

La barra de estado muestra cuántas sentencias están pendientes. Si cancelas una consulta o se agota su tiempo en modo manual y el motor pierde la transacción, la aplicación te lo avisa en **Mensajes** y con una notificación.

## Protecciones antes de ejecutar

La aplicación clasifica cada sentencia (lectura, escritura de datos, estructura o desconocida) antes de enviarla:

- **`UPDATE` o `DELETE` sin `WHERE`** piden confirmación siempre, en cualquier entorno.
- En conexiones con **confirmación de escritura** (por defecto Producción), toda sentencia que modifica datos o estructura abre un modal con la sentencia y su conexión.
- En conexiones de **solo lectura**, las sentencias que no son de lectura se bloquean con un mensaje claro.

Detalles en [Seguridad](./seguridad).

## Tiempo de espera

Cada conexión puede tener un tiempo de espera de consulta (sin límite por defecto). Al agotarse, la consulta se cancela.
