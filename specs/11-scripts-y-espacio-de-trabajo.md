# 11 — Scripts, espacio de trabajo y guardado automático

Esta spec **prevalece** sobre cualquier mención anterior a "carpeta abierta", "scripts sin guardar" o `session.json` en otras specs.

## 1. Todo script es un archivo
- Como en DBeaver: **"Nuevo script" (Ctrl+N, menú o árbol) crea de inmediato un archivo `.sql` en disco**, dentro del espacio de trabajo. No existen scripts "en memoria".
- Nombre: `Script-N.sql`, donde N es el menor número ≥ 1 que no exista ya en la carpeta de destino (D16).
- La pestaña muestra el nombre del archivo. Renombrar: F2 sobre la pestaña o en el árbol de Archivos → renombra el archivo en disco y actualiza la pestaña.
- El archivo nuevo queda asociado a la conexión desde la que se creó (conexión seleccionada en el árbol o la de la pestaña activa).
- **Scripts vacíos**: al cerrar la pestaña de un script cuyo contenido está vacío (solo espacios), el archivo se elimina de disco (`scripts.deleteEmptyOnClose: true`). Al cerrar el programa, los scripts vacíos abiertos **no** se eliminan: se restauran como las demás pestañas.

## 2. Espacio de trabajo
- Es **una carpeta** donde se crean todos los scripts y que muestra la vista **Archivos** de la barra lateral. Reemplaza el concepto de "Abrir carpeta" (D9).
- **Por defecto**: `Documentos\DB Explorer` del usuario (`app.getPath('documents')` + `DB Explorer`), creada automáticamente en el primer arranque si no existe (D17).
- **Cambiar**: menú Archivo › *Cambiar espacio de trabajo…*, Preferencias › Archivos › *Espacio de trabajo* (botón "Cambiar…"), o la paleta de comandos (`db.workspace.change`). Abre un diálogo nativo de selección de carpeta.
- La ruta elegida se guarda en `settings.json` (`"workspace.path"`) y **siempre** se abre ese espacio al iniciar el programa.
- "Restablecer al predeterminado" disponible en Preferencias.
- Al cambiar de espacio:
  1. Se guardan los archivos con cambios (si el guardado automático está activo) o se pregunta por cada uno (Guardar todo / No guardar / Cancelar).
  2. Se guarda el estado de pestañas del espacio actual.
  3. Se cierran las pestañas y se abre el nuevo espacio restaurando **sus** pestañas (si ya se usó antes) o sin pestañas (si es nuevo).
  4. Los scripts existentes **no se mueven** de una carpeta a otra.
- Título de ventana: `<nombre del espacio> — DB Explorer`. En el title bar, el command center muestra el nombre del espacio como placeholder: "Buscar en *DB Explorer*…".
- **Espacio no disponible al iniciar** (carpeta borrada, unidad de red desconectada): modal "No se encuentra el espacio de trabajo `X`" con opciones **Reintentar**, **Elegir otra carpeta** y **Usar el predeterminado**. Esta última no borra `workspace.path` hasta que el usuario elija otra cosa.
- Todas las operaciones de archivos de la vista Archivos quedan restringidas a la raíz del espacio (ver `07`). "Abrir archivo…" (Ctrl+O) sigue permitiendo abrir un `.sql` de cualquier parte; esa pestaña funciona igual, pero el archivo no aparece en el árbol.

## 3. Estado del espacio (restaurar al abrir)
- Guardado en `userData/workspaces/<sha1 de la ruta normalizada>.json`, **no dentro de la carpeta del espacio**. Así no se comparten nombres de conexiones al subir la carpeta a un repositorio.
- Contenido:
  ```jsonc
  {
    "path": "C:\\Users\\pols\\Documents\\DB Explorer",
    "tabs": [
      { "type": "script", "file": "Script-2.sql", "connectionId": "…", "database": "paybox", "schema": "public",
        "viewState": { /* cursor, scroll, plegados de Monaco */ }, "pinned": true },
      { "type": "object", "connectionId": "…", "ref": { "database": "paybox", "schema": "public", "name": "CRendiciones_Conf_Generales" }, "subtab": "data" }
    ],
    "activeTab": 0,
    "fileConnections": { "Script-2.sql": { "connectionId": "…", "database": "paybox", "schema": "public" } },
    "explorer": { "expanded": ["consultas/rendiciones"] }
  }
  ```
  Las rutas de archivos son relativas al espacio (absolutas si el archivo está fuera de él).
- Se escribe (atómicamente: temporal + renombrar) al cambiar pestañas, con un retraso de 1 s, y al cerrar el programa.
- **Al abrir el programa**: se abre el espacio de `workspace.path`, se reabren sus pestañas en el mismo orden, la activa queda enfocada y cada editor recupera cursor y scroll. Las pestañas de objeto se restauran sin conectar; se conectan al enfocarlas.
- Si un archivo de la lista ya no existe, se omite y se muestra un toast: "No se encontraron 2 archivos del espacio de trabajo" con acción "Ver detalles".
- Los tamaños de paneles, el tema y la vista activa de la barra lateral son **globales** (en `userData/ui-state.json`; el ancho de la barra lateral, en `settings.json` como `workbench.sideBar.width`), no por espacio.

## 4. Guardado automático
Configurable en Preferencias › Archivos:
```jsonc
{
  "files.autoSave": true,          // D15 — activar o desactivar
  "files.autoSaveDelay": 5000,     // ms sin escribir antes de guardar
  "scripts.deleteEmptyOnClose": true
}
```

### Con guardado automático ACTIVO
El archivo se guarda en disco en estos momentos:
1. **5 segundos después de que el usuario dejó de escribir** (debounce por archivo; cada tecla reinicia el contador).
2. **Al ejecutar** cualquier sentencia o script de esa pestaña (Ctrl+Enter, Alt+X, F5, "ejecutar selección"…): se guarda **antes** de enviar el SQL al motor. Si el guardado falla, la ejecución continúa igual y se muestra el error de guardado.
3. **Al cerrar el programa**: se guardan todos los archivos con cambios, sin preguntar, y después se escribe el estado del espacio.
4. Además (por coherencia): al cerrar una pestaña y al cambiar de espacio de trabajo.

Mientras hay cambios pendientes de guardar se muestra `●` en la pestaña, igual que sin guardado automático; desaparece al guardar.

### Con guardado automático DESACTIVADO
- Solo se guarda con Ctrl+S / Guardar todo.
- Ejecutar **no** guarda.
- Cerrar una pestaña con cambios → "¿Guardar los cambios en `Script-2.sql`?" **Guardar** / **No guardar** / **Cancelar**.
- Cerrar el programa con cambios → un solo diálogo con la lista de archivos modificados y botones **Guardar todo** / **No guardar** / **Cancelar**. Tras responder, las pestañas se restauran igual al volver a abrir (con el contenido que quedó en disco).

### Reglas comunes
- Escritura atómica (archivo temporal en la misma carpeta + renombrar), conservando codificación, BOM y fin de línea originales.
- Antes de escribir se compara el `mtime` del archivo con el de la última lectura/escritura. Si cambió por fuera, **no se sobrescribe**: toast "`Script-2.sql` cambió en disco" con **Comparar** (diff de Monaco), **Sobrescribir** y **Recargar**.
- Si falla (solo lectura, disco lleno, unidad desconectada): toast de error, el `●` se mantiene y se reintenta en el siguiente disparador.
- El guardado corre en main por IPC (`fs:writeFile`) y no bloquea la escritura en el editor.
- Cerrar el programa espera a que terminen los guardados en curso (máximo 5 s; si se supera, pregunta si cerrar igual).

### Indicador en la status bar
A la derecha, antes de la codificación: `codicon-save` **"Autoguardado"** (activo, `fg`) o **"Autoguardado: no"** (inactivo, `fg.muted`). Clic → activa/desactiva. Durante un guardado, el icono cambia 300 ms a `codicon-loading` girando.

## 5. Preferencias › Archivos (UI)
| Ajuste | Control |
|---|---|
| Espacio de trabajo | Ruta en texto de solo lectura + botones **Cambiar…**, **Abrir en el Explorador**, **Restablecer** |
| Guardado automático | Checkbox "Guardar automáticamente los scripts" |
| Retraso | Input numérico en segundos (1–60), deshabilitado si el guardado automático está desactivado. Descripción: "Se guarda también al ejecutar y al cerrar el programa." |
| Scripts vacíos | Checkbox "Eliminar scripts vacíos al cerrar su pestaña" |
| Ubicación de nuevos scripts | Según D16 |

## 6. Criterios de aceptación
- Ctrl+N crea `Script-N.sql` en el espacio al instante y aparece en la vista Archivos.
- Con autoguardado activo: escribir y esperar 5 s → el archivo en disco tiene el contenido; escribir y ejecutar de inmediato → el archivo se guarda antes de ejecutar; escribir y cerrar la app con Alt+F4 antes de 5 s → el contenido está en disco al volver a abrir.
- Cerrar y abrir la app restaura las mismas pestañas, orden, pestaña activa, cursor y conexión de cada script.
- Cambiar el espacio de trabajo a otra carpeta → los nuevos scripts se crean allí, y al reiniciar se abre esa carpeta.
- Un cambio externo en un archivo abierto no se pisa con el autoguardado.
- Cerrar la pestaña de un script vacío elimina el archivo.
