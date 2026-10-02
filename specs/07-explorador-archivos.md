# 07 — Explorador de archivos

Segunda vista de la side bar (activity bar → `codicon-files`, Ctrl+Shift+E). Comportamiento calcado del Explorer de VS Code, reducido a lo esencial.

## Raíz: el espacio de trabajo (D9)
- La vista Archivos muestra siempre el **espacio de trabajo** definido en `11` (por defecto `Documentos\DB Explorer`, configurable). No hay "Abrir carpeta" independiente.
- Espacios usados recientemente en Archivo › Abrir espacio reciente (máx. 10).
- Todas las operaciones de disco se hacen en **main** (`fs:*` IPC) y quedan **restringidas al espacio de trabajo**: main valida que cada ruta resuelta (`path.resolve` + `realpath`) esté dentro de la raíz. Excepción: "Abrir archivo…" y "Guardar como…" con diálogo nativo.

## Árbol
- Carga perezosa por carpeta, orden: carpetas primero, luego archivos, alfabético sin distinguir mayúsculas.
- Excluidos por defecto (`files.exclude`): `.git`, `node_modules`, `.DS_Store`, `Thumbs.db`.
- Watcher (`fs.watch` recursivo, nativo en Windows) para reflejar cambios externos; debounce 200 ms. Un archivo abierto sin cambios se recarga solo; si tiene cambios sin guardar, aparece el aviso con Comparar / Sobrescribir / Recargar.
- Iconos: `.sql` (`codicon-database` pequeño o icono SQL), `.json` (`codicon-json`), `.md` (`codicon-markdown`), `.csv` (`codicon-table`), carpeta abierta/cerrada (`codicon-folder-opened` / `codicon-folder`), otros (`codicon-file`).
- Sincroniza la selección con la pestaña activa (`files.autoReveal: true`).

## Operaciones
| Acción | Cómo |
|---|---|
| Abrir | Clic → pestaña *preview*; doble clic → pestaña fija. `.sql`, `.txt`, `.json`, `.md`, `.csv`, `.log`, `.xml`, `.yml` se abren en Monaco con su lenguaje. Otros: "Abrir con la aplicación del sistema" (`shell.openPath`). |
| Nuevo archivo / carpeta | Botones de cabecera o menú contextual → input en línea en el árbol. Extensión `.sql` sugerida si no se escribe ninguna. |
| Renombrar | F2 o menú → input en línea; valida nombre y colisiones. Si el archivo está abierto, la pestaña se actualiza. |
| Mover | Arrastrar y soltar dentro del árbol (con confirmación si `files.confirmDragAndDrop`). |
| Copiar / cortar / pegar | Ctrl+C / Ctrl+X / Ctrl+V sobre nodos. Colisión → sufijo " copia". |
| Duplicar | Menú contextual. |
| Eliminar | Supr → envía a la **Papelera** (`shell.trashItem`) con confirmación. Nunca borrado permanente. |
| Copiar ruta / ruta relativa | Shift+Alt+C / Ctrl+K Ctrl+Shift+C. |
| Mostrar en el Explorador de Windows | `shell.showItemInFolder`. |
| Ejecutar archivo SQL | Menú contextual "Ejecutar en…" → elegir conexión → abre el archivo y ejecuta como script. |
| Buscar | Filtro por nombre al escribir con el árbol enfocado (como VS Code). Búsqueda en contenido: fuera de v1. |

## Asociación archivo ↔ conexión
- Al abrir un `.sql` se restaura la última conexión usada con ese archivo (`fileConnections` en el estado del espacio, ver `11` §3; clave = ruta relativa al espacio).
- Opcional: comentario en la primera línea `-- @connection: PayBox Prod` reconocido al abrir (útil al compartir scripts). Desactivado por defecto (`files.connectionHeader`). *No implementado en M5 (ver `NOTAS.md`).*

## Guardado
- Reglas de guardado, guardado automático y cierre: ver `11` §4.
- Ctrl+S guarda; `●` en la pestaña y en el árbol mientras hay cambios sin escribir en disco.
- Codificación UTF-8 por defecto; detectar BOM y conservarlo; conservar fin de línea (CRLF/LF) del archivo y mostrarlo en la status bar (clic para cambiar).
