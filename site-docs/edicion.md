# Editar datos

Puedes modificar los datos directamente en la grilla.

## Cuándo es editable

Un resultado es editable cuando proviene de **una sola tabla** y contiene todas las columnas de su **clave primaria** (o de un índice único no nulo). En la [pestaña de objeto](./objetos) siempre se conoce la tabla.

Si no se puede determinar, la grilla es de **solo lectura** y un mensaje te explica por qué. Las conexiones de solo lectura nunca permiten editar.

## Acciones

| Acción | Cómo |
| --- | --- |
| Editar una celda | Doble clic, <kbd>F2</kbd> o <kbd>Enter</kbd> |
| Vaciar celdas | <kbd>Supr</kbd> |
| Establecer `NULL` | <kbd>Shift</kbd>+<kbd>Supr</kbd> |
| Agregar una fila | <kbd>Alt</kbd>+<kbd>Insert</kbd> |
| Duplicar una fila | Menú contextual |
| Eliminar filas | <kbd>Ctrl</kbd>+<kbd>Supr</kbd> |
| Pegar desde Excel | <kbd>Ctrl</kbd>+<kbd>V</kbd> (TSV); las filas que sobran se agregan |
| Deshacer un cambio | <kbd>Ctrl</kbd>+<kbd>Z</kbd> con el foco en la grilla |

## Cambios pendientes

Nada se envía a la base hasta que lo decides. Los cambios se muestran con colores (celdas modificadas, filas nuevas y filas marcadas para eliminar) y la barra indica **Guardar (n)** con el número de cambios.

- **Guardar**: <kbd>Ctrl</kbd>+<kbd>S</kbd> con el foco en la grilla.
- **Descartar** revierte todos los cambios pendientes.
- **Ver SQL** muestra las sentencias que se van a ejecutar, con los valores literales, solo para lectura.

## Cómo se guarda

La aplicación genera `UPDATE … WHERE clave = …`, `INSERT` y `DELETE` **parametrizados**, todo en una transacción.

- Si **algo falla**, se revierte todo, las celdas siguen pendientes y la fila con error se marca con un mensaje.
- Si un `UPDATE` o `DELETE` afecta a una cantidad de filas distinta de una, se revierte todo y se avisa: «la clave no identifica una fila única».
- En **transacción manual**, los cambios quedan pendientes hasta tu próximo Commit o Rollback.
- En conexiones de **Producción** (o con confirmación de escritura) siempre aparece el modal de confirmación antes de aplicar.
