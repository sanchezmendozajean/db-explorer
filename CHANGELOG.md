# Changelog

## v0.1.4

### Novedades
- Al pegar un valor único con varias celdas seleccionadas en la grilla (rango, columnas o filas enteras), se pega en todas las celdas editables.

### Correcciones
- El editor de procedimientos y funciones y la vista DDL no respetaban las preferencias del editor (tamaño de fuente, tabulación, ajuste de línea, etc.).

## v0.1.3

### Novedades
- **Dividir editor** (Ctrl+, botón de la barra, menú Ver y menú de la pestaña): dos grupos de pestañas lado a lado, con un único panel de resultados de ancho completo debajo que sigue a la pestaña enfocada. Las pestañas se mueven entre grupos arrastrándolas, y el estado se restaura al reiniciar.
- La ventana recuerda su posición, su tamaño y si estaba maximizada; si el monitor ya no está, abre centrada.
- **Tablas sin clave primaria ni índice único** ahora se pueden editar: cada fila se identifica por todos sus valores. Se avisa con la insignia "Sin clave" y al guardar siempre se muestra el SQL; si hay filas idénticas, no se aplica nada.
- Menú de la grilla: **Generar UUID** para las celdas seleccionadas y un menú propio al hacer clic derecho en el número de fila (copiar, agregar, duplicar y eliminar filas).
- Mayor contraste en el texto seleccionado.

### Cambios
- Renombrar base de datos se desactiva en MariaDB/MySQL (no tienen soporte nativo). En PostgreSQL y SQL Server, con una conexión de Producción, se muestra el SQL antes de aplicarlo.

### Correcciones
- El menú contextual de la grilla no se cerraba al hacer clic en otra celda.

## v0.1.2

### Novedades
- **Formatear sentencia** (Ctrl+Alt+F): formatea solo la sentencia bajo el cursor.
- El formateo deja la primera tabla junto al `FROM` y los `JOIN` sin sangría.
- Las opciones de formateo (sentencia y documento) están en el menú contextual del editor y en el botón Formatear de la barra.
- Doble clic en la zona vacía de la barra de pestañas abre un script nuevo, como en VS Code; el menú "Mostrar pestañas abiertas" también ofrece "Nuevo script".
- El buscador de Preferencias ocupa todo el ancho.

## v0.1.1

### Novedades
- **Diálogo de restauración** rediseñado: host de destino, opciones en dos columnas y confirmación junto a los botones.
- **Actualización automática**: al abrir busca y descarga la versión nueva (Preferencias › Actualizaciones); el engranaje muestra un punto rojo y ofrece "Reiniciar para instalar nueva versión". "Buscar actualización" permite la búsqueda manual. No aplica a la versión portable.

## v0.1.0

Primera versión pública de DB Explorer.

### Novedades
- Cliente de escritorio para **PostgreSQL, MariaDB/MySQL, SQLite y SQL Server**, con aspecto de VS Code y editor Monaco.
- Gestión de conexiones con las contraseñas cifradas por el sistema; explorador de objetos (bases, esquemas, tablas, vistas, rutinas).
- Editor SQL con autocompletado según el catálogo, formateo, ejecución de sentencia o de script, cancelación y modo de transacción manual.
- Grilla de resultados virtualizada con edición de celdas, visor de valores, filtros, formatos de datos y exportación.
- Pestaña de objeto con estructura, datos y edición de rutinas.
- Plan de ejecución visual para los cuatro motores.
- Explorador de archivos `.sql` con selección múltiple y filtro global, y espacios de trabajo.
- Respaldo y restauración de bases de datos.
- Instalador de Windows (NSIS) y versión portable.
