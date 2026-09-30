# 06 — Resultados y formatos de datos

## Grilla
Glide Data Grid (D4). Aspecto y comportamiento visual en `04-interfaz.md` §10.

### Modelo de datos en el renderer
```ts
interface ResultSetState {
  id: string; queryId: string; statementIndex: number;
  columns: ResultColumn[];             // name, nativeType, logicalType, sourceTable?, sourceColumn?, isPk?
  rows: unknown[][];                   // valores crudos tal como llegan del driver
  truncated: boolean; rowCount: number; durationMs: number; executedAt: string;
  editable: false | { table: ObjectRef; keyColumns: string[] };
  pending: PendingChanges;             // ediciones, inserciones, eliminaciones
  viewState: { sort?: SortSpec[]; quickFilter?: string; hidden: string[]; widths: Record<string, number> };
}
```
- Los valores se guardan **crudos** (strings para decimales/fechas); el formateo es solo de presentación. Copiar/exportar usa el valor crudo salvo que el usuario elija "copiar con formato".
- Orden y filtro rápido: en cliente sobre lo cargado. Si el resultado está truncado, mostrar aviso "Ordenado sobre 500 filas cargadas — Ordenar en servidor" que re-ejecuta envolviendo en `ORDER BY` (solo en pestaña de objeto, donde se conoce la tabla).

### Carga
- Límite por defecto `results.maxRows = 500`. "Cargar más" pide el siguiente lote a la misma sesión (cursor abierto si el driver lo permite; si no, re-ejecuta con OFFSET en pestaña de objeto).
- "Cargar todo" pide confirmación si se superan 100 000 filas.

## Formatos de datos (el punto débil de DBeaver)

Principio: **un lugar, pocos ajustes, vista previa inmediata**. Tres niveles, del más general al más específico:

1. **Global por tipo lógico** — en Preferencias › Formatos de datos.
2. **Por conexión** — opcional, sobrescribe el global (p. ej. una BD en otra zona horaria).
3. **Por columna, en el resultado actual** — clic derecho › Formato de columna, sin salir de la grilla. Checkbox "Recordar para `tabla.columna`" guarda la regla.

### Ajustes globales (settings.json)
```jsonc
{
  "format.locale": "es-PE",                 // separadores por defecto
  "format.null": "NULL",                    // texto para nulos ("", "∅", "(null)")
  "format.number.thousandsSeparator": true,
  "format.number.decimalSeparator": ".",    // "." | "," | "locale"
  "format.decimal.mode": "asStored",        // "asStored" (escala de la BD) | "fixed" | "trimZeros"
  "format.decimal.places": 2,               // usado si mode = fixed
  "format.float.maxDigits": 15,
  "format.date": "yyyy-MM-dd",
  "format.time": "HH:mm:ss",
  "format.datetime": "yyyy-MM-dd HH:mm:ss",
  "format.datetime.showMillis": "whenPresent", // "always" | "never" | "whenPresent"
  "format.datetimetz.display": "asStored",  // "asStored" | "local" | "utc"
  "format.boolean": "checkbox",             // "checkbox" | "true/false" | "1/0" | "sí/no"
  "format.binary": "hex",                   // "hex" | "base64" | "size"
  "format.binary.maxBytes": 64,
  "format.json": "compact",                 // "compact" | "pretty" (en visor siempre pretty)
  "format.text.maxLength": 500,             // truncado visual en celda
  "results.maxRows": 500,
  "results.alternateRows": true,
  "results.fontSize": 12
}
```

### UI de Preferencias › Formatos de datos
Una fila por tipo lógico con: control(es) + **vista previa en vivo** con un valor de ejemplo:
| Tipo | Controles | Ejemplo |
|---|---|---|
| Decimal | modo, decimales, separadores | `999999999.00` → `999,999,999.00` |
| Fecha y hora | patrón (select con presets + campo libre), milisegundos | `2026-09-30 08:42:52.658` |
| Booleano | select | ☑ |
| Nulo | texto | `NULL` |
| Binario | select | `0x89504E47…` |
Botón "Restablecer" por fila.

### Formato por columna (menú contextual)
Submenú con los mismos controles del tipo de esa columna en un popover de 280 px, con vista previa usando el valor de la celda seleccionada. Opción "Alinear: izquierda/derecha/centro". Guardado en `settings.json` como:
```jsonc
"format.columns": {
  "PayBox Prod/paybox/public/CRendiciones_Conf_Generales/Documentos_ImporteLimite": { "decimal.mode": "fixed", "decimal.places": 0 }
}
```

## Copiar y exportar

### Copiar la selección (Ctrl+C / Ctrl+Shift+C)
Modos de selección en `04` §10 (celdas, filas, columnas, todo). La copia actúa **solo sobre lo seleccionado**:
- **Ctrl+C**: TSV sin cabeceras (pega bien en Excel). **Ctrl+Shift+C**: igual, con una primera línea de cabeceras que contiene solo las columnas copiadas.
- Filas copiadas = las que tienen al menos una celda seleccionada; columnas copiadas = las que tienen al menos una celda seleccionada. Se respeta el orden visible de la grilla (orden y filtro aplicados, columnas en su posición actual). Las columnas ocultas nunca se copian.
- Selección no rectangular (Ctrl+clic): las celdas no seleccionadas dentro de ese contorno se copian vacías, para que al pegar en Excel cada valor quede en su columna.
- Fila o columna seleccionada completa = todas sus celdas visibles.
- Una sola celda: se copia solo el valor, sin tabulador ni salto de línea final; con Ctrl+Shift+C, cabecera + salto de línea + valor.
- `NULL` se copia como cadena vacía (configurable: `results.copy.nullAs`, por defecto `""`). Valores con tabulador, salto de línea o comillas se entrecomillan según las reglas TSV/CSV de Excel.
- Se copia el valor **crudo** (ver arriba); "copiar con formato" es una opción aparte del menú Copiar como.
- Si la selección supera 100 000 celdas, se pide confirmación antes de copiar.

### Copiar la tabla completa (menú Exportar)
- **Copiar tabla** y **Copiar tabla (con cabeceras)**: copian al portapapeles, en TSV, **todas las filas cargadas** y todas las columnas visibles, sin importar la selección. Respetan el orden y el filtro rápido aplicados.
- Si el resultado está truncado, se copian las filas cargadas y un aviso (toast) lo indica: "Se copiaron 500 filas cargadas (el resultado está truncado)", con la acción "Cargar todo y copiar".

### Otros formatos
- Copiar como: CSV, TSV, JSON (array de objetos), Markdown, `INSERT INTO …` (dialecto de la conexión), lista `IN (…)` de la columna seleccionada.
- Exportar (todas las filas del resultado; si está truncado, ofrecer "re-ejecutar sin límite y exportar en streaming"): CSV (separador, comillas, encoding UTF-8 con/sin BOM), JSON, XLSX (tipos reales: números como número, fechas como fecha), SQL INSERT.
- Exportación en streaming desde el DB Host directo a archivo para resultados grandes, con progreso en notificación y cancelación.

## Edición de datos (D7)
- Editable solo si el result set proviene de **una sola tabla** y contiene todas las columnas de su **PK** (o de un índice único no nulo). Detectado por metadatos de columna (`pg` da `tableID`; MariaDB y SQL Server exponen tabla origen; SQLite vía `sqlite3_column_table_name` no disponible → solo pestaña de objeto). Si no se puede determinar, la grilla es de solo lectura con tooltip explicando por qué.
- En la pestaña de objeto (Datos) siempre se conoce la tabla.
- Acciones: editar celda, vaciar celda (Supr), establecer NULL (Shift+Supr), agregar fila (Alt+Insert), duplicar fila, eliminar filas (Ctrl+Supr).
- Cambios pendientes con colores de `04` §2. Deshacer por celda (Ctrl+Z con foco en grilla).
- **Guardar** (Ctrl+S con foco en la grilla): genera `UPDATE … WHERE pk = …`, `INSERT`, `DELETE` parametrizados, en una transacción. "Ver SQL" muestra las sentencias con valores literales (solo para lectura).
- Si la conexión es Producción: el modal de confirmación de `04` §14 aparece siempre antes de aplicar.
- Error al guardar → rollback, las celdas quedan pendientes y se marca la fila con error (tooltip con el mensaje).
- `UPDATE` afecta ≠ 1 fila → rollback y aviso "la clave no identifica una fila única".

## Mensajes e historial
- Pestaña **Mensajes**: por cada sentencia ejecutada, línea con hora, duración, filas afectadas/devueltas, y los NOTICE/PRINT. Errores en rojo con enlace "Ir a la línea".
- **Historial** (`history.sqlite`): lista filtrable por texto y conexión; columnas fecha, conexión, duración, filas, estado, SQL (primera línea). Doble clic abre en nuevo script; Enter inserta en el script actual. Retención configurable (`history.maxEntries`, por defecto 5000).
