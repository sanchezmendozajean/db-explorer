# La vista Archivos

La segunda vista de la barra lateral (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd>) es un explorador de archivos con el comportamiento del Explorador de VS Code, reducido a lo esencial. Muestra siempre tu [espacio de trabajo](./espacio-de-trabajo).

## El árbol

- Las carpetas se cargan al abrirlas, y se ordenan primero las carpetas y luego los archivos, sin distinguir mayúsculas.
- Se excluyen `.git`, `node_modules`, `.DS_Store` y `Thumbs.db`.
- Si cambias archivos desde fuera de la aplicación, el árbol se actualiza solo. Un archivo abierto sin cambios se recarga; si tenía cambios sin guardar, se te avisa.
- La selección sigue a la pestaña activa.
- Cada tipo de archivo tiene su ícono (`.sql`, `.json`, `.md`, `.csv`, carpetas…).

## Operaciones

| Acción | Cómo |
| --- | --- |
| **Abrir** | Clic abre una pestaña de vista previa; doble clic la fija. Se abren en el editor `.sql`, `.txt`, `.json`, `.md`, `.csv`, `.log`, `.xml` y `.yml`. Otros tipos se abren con la aplicación del sistema. |
| **Nuevo archivo / carpeta** | Botones de la cabecera o menú contextual; se escribe el nombre en el propio árbol |
| **Renombrar** | <kbd>F2</kbd>; si el archivo está abierto, la pestaña se actualiza |
| **Mover** | Arrastrar y soltar dentro del árbol |
| **Copiar, cortar y pegar** | <kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>X</kbd> / <kbd>V</kbd>; si hay colisión, se agrega «copia» al nombre |
| **Duplicar** | Menú contextual |
| **Eliminar** | <kbd>Supr</kbd>: va a la **Papelera**, con confirmación. Nunca se borra de forma permanente. |
| **Copiar ruta** | <kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd> (ruta relativa con <kbd>Ctrl</kbd>+<kbd>K</kbd> <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>C</kbd>) |
| **Mostrar en el Explorador de Windows** | Menú contextual |
| **Ejecutar en…** | Menú contextual: elige una conexión, abre el archivo y lo ejecuta como script |

### Selección múltiple

Con <kbd>Ctrl</kbd>+clic sumas o quitas archivos, y con <kbd>Shift</kbd>+clic o <kbd>Shift</kbd>+flechas eliges un rango. Copiar, cortar, eliminar y arrastrar actúan sobre todos los seleccionados.

### Filtro

Escribe con el árbol enfocado para filtrar por nombre. El filtro busca en **todo el espacio**, no solo en las carpetas abiertas (carga hasta 5000 entradas y 8 niveles de profundidad).

## Asociación entre archivo y conexión

Al abrir un `.sql`, se restaura la **última conexión** con la que lo usaste en este equipo.

Para compartir scripts hay una opción: si activas `files.connectionHeader` en Preferencias, una primera línea como

```sql
-- @connection: Tienda
```

elige la conexión con ese nombre al abrir un archivo que aún no tenga ninguna asociada en tu equipo. La asociación guardada siempre manda.

## Seguridad de las rutas

Todas las operaciones de disco quedan **restringidas al espacio de trabajo**: se verifica cada ruta resuelta. Las únicas excepciones son <span class="ui">Abrir archivo…</span> y <span class="ui">Guardar como…</span>, que usan el diálogo nativo del sistema.
