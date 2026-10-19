# Copiar y exportar

## Copiar la selección

| Atajo | Qué copia |
| --- | --- |
| <kbd>Ctrl</kbd>+<kbd>C</kbd> | Lo seleccionado, como TSV **sin cabeceras** (pega bien en Excel) |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd> | Lo mismo, con una primera línea de cabeceras de las columnas copiadas |

Detalles:

- Respeta el orden visible de la grilla (orden y filtro aplicados) y **no copia las columnas ocultas**.
- En una selección no rectangular (con <kbd>Ctrl</kbd>+clic), las celdas no seleccionadas dentro del contorno se copian vacías para que cada valor caiga en su columna al pegar en Excel.
- Una sola celda se copia sin tabulador ni salto de línea.
- `NULL` se copia como cadena vacía.
- Los valores con tabuladores, saltos de línea o comillas se entrecomillan según las reglas de Excel.
- Se copia el valor **crudo**, salvo que elijas «con formato».
- Si la selección supera las 100 000 celdas, se pide confirmación.

## Copiar la tabla completa

En el menú **Exportar**:

- **Copiar tabla** y **Copiar tabla (con cabeceras)** copian todas las filas cargadas y las columnas visibles, sin importar la selección.
- Si el resultado está truncado, un aviso lo indica y ofrece **Cargar todo y copiar**.

## Copiar como

En el menú contextual, <span class="ui">Copiar como</span> ofrece:

- **CSV**, **TSV** y **TSV con formato**
- **JSON** (arreglo de objetos)
- **Markdown**
- **`INSERT INTO …`** con el dialecto de la conexión
- **Lista `IN (…)`** con los valores de la columna seleccionada

## Exportar a un archivo

El menú **Exportar** guarda **todas las filas** del resultado:

| Formato | Notas |
| --- | --- |
| **CSV** | Separador y comillas configurables, UTF-8 con o sin BOM |
| **JSON** | Arreglo de objetos |
| **XLSX** | Con tipos reales: números como número y fechas como fecha |
| **SQL INSERT** | Sentencias `INSERT` con el dialecto de la conexión |

Si el resultado está truncado, se ofrece **volver a ejecutar sin límite y exportar en streaming**. La consulta se lee por lotes directamente al archivo, así que funciona con resultados enormes sin llenar la memoria, con progreso en una notificación y la posibilidad de cancelar.
