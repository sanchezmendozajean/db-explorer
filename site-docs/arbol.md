# El árbol de objetos

La vista **Conexiones** muestra tus conexiones y, dentro de cada una, sus bases de datos y objetos. Los nodos se cargan **bajo demanda**: abrir una rama nunca congela la interfaz.

## Qué muestra

Conexión → base de datos → esquema → carpetas de tipo → objetos:

| Nivel | Contenido |
| --- | --- |
| Conexión | Punto de color del entorno, ícono del motor, y host y puerto (o nombre del archivo) |
| Base de datos | Una por base; en SQLite, la propia |
| Esquema | En los motores que los tienen |
| Carpetas de tipo | **Tablas**, **Vistas**, **Funciones**, **Procedimientos** y **Secuencias**, con su cantidad |
| Tabla / vista | Con sus columnas, índices y claves |
| Columna | Nombre, tipo y `NOT NULL`; las claves primarias llevan un ícono de llave |

## Filtrar

El cuadro <span class="ui">Filtrar (tablas, vistas…)</span> bajo la cabecera filtra por nombre los objetos que ya están cargados. Las carpetas y conexiones siempre se muestran.

## Abrir objetos

| Acción | Resultado |
| --- | --- |
| Doble clic en una tabla o vista | Abre su [pestaña de objeto](./objetos) con los datos |
| Doble clic en un procedimiento o función | Abre su [definición editable](./rutinas) |
| Clic central o <kbd>Ctrl</kbd>+<kbd>Enter</kbd> sobre una tabla | Crea un script con `SELECT *` limitado a 500 filas (con la sintaxis del motor) |
| Arrastrar una tabla o columna al editor | Inserta su nombre calificado y entrecomillado según el motor |

## Menús contextuales

**Tabla:** Ver datos, Ver estructura, Nuevo script (SELECT, INSERT, UPDATE, DELETE, DDL), Copiar nombre, Copiar nombre calificado, Refrescar y Contar filas.

**Base de datos** (PostgreSQL, MariaDB/MySQL y SQL Server): Nuevo script SQL, Respaldar, Restaurar, Renombrar, Eliminar y Refrescar. Más en [Administrar bases de datos](./administrar-bases).

**Conexión:** ver [Conexiones](./conexiones#organizar).

## Teclado

| Tecla | Acción |
| --- | --- |
| Flechas | Moverse; <kbd>←</kbd> y <kbd>→</kbd> contraen y expanden |
| <kbd>Enter</kbd> | Abrir |
| <kbd>F2</kbd> | Renombrar (conexiones, carpetas y bases) |
| <kbd>Supr</kbd> | Eliminar (con confirmación) |
| <kbd>F5</kbd> | Refrescar el nodo |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> | Llevar el foco al árbol |

## Objetos del sistema

Por defecto no se muestran. Actívalos con <span class="ui">Mostrar objetos del sistema</span> en el diálogo de la conexión o en el menú <span class="ui">⋯</span> de la cabecera.
