# Resultados

Los resultados se muestran en una **grilla** pensada para ser rápida con muchas filas.

## La grilla

- **Cabeceras** con un ícono del tipo de dato (numérico, texto, fecha, JSON, booleano, clave primaria) y un botón de orden.
- **Números** alineados a la derecha, texto a la izquierda y `NULL` en cursiva atenuada.
- **Ancho de columna** inicial según el contenido; puedes redimensionarlas y el ancho se recuerda.
- **Filas alternadas** y columna con el número de fila.
- Los valores se guardan **tal cual los entrega el motor**; el formato es solo de presentación (ver [Formatos de datos](./formatos)).

## Seleccionar

La selección funciona como una hoja de cálculo:

| Qué | Cómo |
| --- | --- |
| Celdas | Clic, arrastre, <kbd>Shift</kbd>+clic para un rango, <kbd>Ctrl</kbd>+clic para sumar celdas sueltas |
| Filas | Clic en el número de fila; <kbd>Shift</kbd>+<kbd>Espacio</kbd> selecciona la fila actual |
| Columnas | Clic en la cabecera; <kbd>Ctrl</kbd>+<kbd>Espacio</kbd> selecciona la columna actual |
| Todo | <kbd>Ctrl</kbd>+<kbd>A</kbd> o la esquina superior izquierda |

Al seleccionar celdas numéricas, el pie del panel muestra la **suma, el promedio, el mínimo y el máximo**, como Excel.

## Ordenar y filtrar

- El botón de orden de cada cabecera ordena por esa columna.
- El campo **Filtrar resultados…** filtra todas las columnas.
- Ambos trabajan **sobre las filas ya cargadas**. En la [pestaña de objeto](./objetos) puedes ordenar en el servidor.

## Cuántas filas se cargan

El selector **Límite** de la barra de resultados define cuántas filas se piden (100, 500, 1000, 5000 o Todo; 500 por defecto). Si el resultado está truncado, el pie lo indica y ofrece:

- **Cargar más**: pide el siguiente lote a la misma sesión.
- **Cargar todo**: carga hasta 100 000 filas y, si aún hay más, pide confirmación antes de traer el resto.

## Visor de valor

<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> sobre una celda abre un panel lateral con el **valor completo**, con el lenguaje detectado (JSON, XML o texto). Si la celda es editable, el valor se puede modificar desde ahí: <kbd>Ctrl</kbd>+<kbd>Enter</kbd> o <span class="ui">Aplicar</span> lo registra como cambio pendiente, y <span class="ui">Establecer NULL</span> lo pone en `NULL`.

## Menú contextual de la celda

Copiar, Copiar con cabeceras, Copiar como (CSV, TSV, JSON, `INSERT`, lista `IN (…)`), Pegar, Establecer NULL, Ver valor, Filtrar por este valor y Formato de columna. Actúa sobre la selección; si haces clic derecho fuera de ella, primero selecciona esa celda.

## Varios resultados y pestañas

Cada sentencia crea su pestaña de resultado. Los resultados son **por pestaña de script**: cada script conserva los suyos. Solo viven en memoria: no se guardan en disco.

## Pie del panel

Muestra el número de filas (y si está truncado), la duración, la hora de ejecución y, a la derecha, los cálculos de la selección y el número de cambios pendientes.
