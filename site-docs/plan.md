# Plan de ejecución

Muestra **cómo el motor piensa ejecutar una consulta** (plan *estimado*, sin ejecutarla) o **cómo la ejecutó** (plan *real*, con filas y tiempos medidos). La vista es la misma para los cuatro motores.

![La pestaña Plan](/img/plan-dark.png){.shot}

## Pedir un plan

| Comando | Atajo | Qué hace |
| --- | --- | --- |
| **Explicar plan** | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>E</kbd> | Pide el plan **estimado**. No ejecuta la sentencia. |
| **Explicar y ejecutar** | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd> | **Ejecuta** la sentencia y devuelve el plan con valores **reales**. |

También están en el menú **Consulta**, en el menú contextual del editor y en el botón de la bombilla de la barra del editor.

- Opera sobre **una sola sentencia**: la selección o la que está bajo el cursor.
- Usa la **sesión de la pestaña**, así que ve sus tablas temporales y sus cambios sin confirmar.
- Se cancela como cualquier ejecución.

::: tip Las escrituras nunca se quedan
Si la sentencia modifica datos, *Explicar y ejecutar* la ejecuta dentro de una transacción que **siempre se revierte**. Solo se usa para medir, nunca para cambiar datos. Aun así, en conexiones con confirmación de escritura se pide confirmar primero.
:::

## Qué entrega cada motor

| Motor | Estimado | Real |
| --- | --- | --- |
| PostgreSQL | Sí | Sí (con buffers) |
| MariaDB | Sí | Sí |
| MySQL 8+ | Sí | Sí (no para `UPDATE`/`DELETE` de una tabla; se informa el motivo) |
| SQL Server | Sí | Sí |
| SQLite | Sí | No disponible: SQLite no entrega filas ni tiempos reales por paso |

## La pestaña Plan

Aparece en el panel de resultados, antes de **Mensajes**. Hay una por pestaña de editor: el siguiente plan la reemplaza.

- **Barra superior**: un chip **Estimado** o **Real**, el resumen (costo total, tiempo de planificación y de ejecución, según lo que entregue el motor) y un contador de avisos que salta al primero con un clic.
- **Árbol-tabla** con una fila por operación: operación, objeto (tabla o índice), **costo** (barra con el porcentaje propio sobre el total), filas estimadas y, en planes reales, **filas reales**, bucles y **tiempo**. La condición del filtro o del *join* aparece bajo la operación.
- **Panel de detalle**: al seleccionar un nodo, a la derecha ves todas las propiedades que informó el motor.
- Botones: **Expandir todo**, **Contraer todo**, **Ver original** (el JSON, texto o XML tal cual lo devolvió el motor), **Copiar original** y **Volver a explicar**.

Con el teclado: <kbd>↑</kbd>/<kbd>↓</kbd> mueven la selección, <kbd>→</kbd>/<kbd>←</kbd> expanden y contraen, <kbd>Enter</kbd> abre el detalle y <kbd>Ctrl</kbd>+<kbd>C</kbd> copia la fila.

## Avisos

Se calculan con umbrales fijos, sin configuración:

| Aviso | Cuándo aparece |
| --- | --- |
| **Recorrido completo** | Lectura secuencial de una tabla con 10 000 filas estimadas o más |
| **Estimación errada** | Solo en planes reales: las filas reales y las estimadas difieren 10 veces o más |
| **Uso de disco** | Ordenamientos o *hashes* que se derraman a disco o a `tempdb` |
| **Del motor** | Advertencias propias: índices faltantes en SQL Server, `Using temporary` o `Using filesort` en MariaDB/MySQL |
