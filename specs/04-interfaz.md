# 04 — Interfaz (para maqueta en Claude Design y para implementación)

Distribución tomada de DBeaver (árbol a la izquierda, editor arriba, resultados abajo) con el **lenguaje visual de VS Code**: superficies planas, bordes de 1 px, sin degradados ni sombras (salvo menús y diálogos), iconos Codicons, tipografía del sistema, densidad compacta.

## 1. Estructura general

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ TITLE BAR (35px)  [logo] Archivo Editar Ver Consulta Ayuda   [ buscar/comando ] _ □ ✕ │
├──┬───────────────┬────────────────────────────────────────────────────────────┤
│A │ SIDE BAR      │ EDITOR GROUP                                               │
│C │ (280px)       │ ┌ tabs (35px) ───────────────────────────────────────────┐ │
│T │               │ │ ● Script-1  │ Script-2 │ clientes (datos) │ ...         │ │
│I │ CONEXIONES  ⋯ │ ├ editor toolbar (30px) ─────────────────────────────────┤ │
│V │ [filtro     ] │ │ ▶ ▶▶ ■ │ [PayBox Prod ▾] [paybox ▾] [public ▾] │ Auto ▾ │ │
│I │ ▸ 🟢 local    │ ├────────────────────────────────────────────────────────┤ │
│T │ ▾ 🔴 PayBox   │ │ 1  select * from "CRendiciones_Conf_Generales"          │ │
│Y │   ▾ paybox    │ │ 2                                                       │ │
│  │     ▾ public  │ │          MONACO                                         │ │
│B │       ▸ Tablas│ ├──────────────── sash (4px) ────────────────────────────┤ │
│A │       ▸ Vistas│ │ RESULTS PANEL                                          │ │
│R │ ▸ 🟡 SGA TEST │ │ tabs: Resultado 1 │ Resultado 2 │ Mensajes │ Historial │ │
│  │               │ │ toolbar: filtro · ↻ · 💾 · ✕ · exportar · 500 ▾         │ │
│48│               │ │ GRID                                                    │ │
│px│               │ │ footer: 1 fila · 4 ms · 08:47:07                         │ │
├──┴───────────────┴────────────────────────────────────────────────────────────┤
│ STATUS BAR (22px) 🔴 PayBox Prod · PostgreSQL 16.2 │ Ln 1, Col 38 │ UTF-8 │ Auto-commit │
└───────────────────────────────────────────────────────────────────────────────┘
```

Tamaño de referencia para la maqueta: **1600 × 1000 px**. Mínimo soportado: 1024 × 640.

Todas las divisiones (side bar | editor, editor / resultados) son redimensionables arrastrando un *sash* de 4 px que se ilumina en azul al pasar el mouse. Doble clic en el sash restaura el tamaño por defecto.

## 2. Tokens de color

Usar exactamente estos valores (tomados de VS Code *Dark Modern* / *Light Modern*).

| Token | Oscuro | Claro | Uso |
|---|---|---|---|
| `bg.titleBar` | `#181818` | `#F8F8F8` | Title bar |
| `bg.activityBar` | `#181818` | `#F8F8F8` | Activity bar |
| `bg.sideBar` | `#181818` | `#F8F8F8` | Side bar |
| `bg.editor` | `#1F1F1F` | `#FFFFFF` | Editor, grilla |
| `bg.panel` | `#181818` | `#F8F8F8` | Panel de resultados (cabecera y toolbar) |
| `bg.statusBar` | `#181818` | `#F8F8F8` | Status bar |
| `bg.tabActive` | `#1F1F1F` | `#FFFFFF` | Pestaña activa |
| `bg.tabInactive` | `#181818` | `#F8F8F8` | Pestaña inactiva |
| `bg.input` | `#313131` | `#FFFFFF` | Inputs, selects |
| `bg.hover` | `#2A2D2E` | `#F2F2F2` | Hover en listas/árbol/filas |
| `bg.selection` | `#04395E` | `#E4F0FB` | Ítem seleccionado con foco |
| `bg.selectionInactive` | `#37373D` | `#E4E6F1` | Ítem seleccionado sin foco |
| `bg.menu` | `#1F1F1F` | `#FFFFFF` | Menús contextuales, dropdowns |
| `bg.gridHeader` | `#252526` | `#F3F3F3` | Cabecera de columnas de la grilla |
| `bg.gridRowAlt` | `#232323` | `#FAFAFA` | Filas alternas (sutil) |
| `bg.cellEdited` | `#3A3D1F` | `#FFF8C5` | Celda modificada sin guardar |
| `bg.rowDeleted` | `#4B1818` | `#FDE7E9` | Fila marcada para eliminar |
| `bg.rowInserted` | `#1E3A1E` | `#E6F4EA` | Fila nueva |
| `border` | `#2B2B2B` | `#E5E5E5` | Todos los bordes y separadores |
| `border.focus` | `#0078D4` | `#005FB8` | Foco, sash activo, borde superior de pestaña activa |
| `fg` | `#CCCCCC` | `#3B3B3B` | Texto principal |
| `fg.muted` | `#9D9D9D` | `#6E6E6E` | Texto secundario, hints, host en el árbol |
| `fg.disabled` | `#6E6E6E` | `#A0A0A0` | Deshabilitado |
| `fg.null` | `#6E6E6E` (itálica) | `#A0A0A0` (itálica) | Valor `NULL` en grilla |
| `accent` | `#0078D4` | `#005FB8` | Botón primario, badges, enlaces |
| `error` | `#F85149` | `#E51400` | Errores |
| `warning` | `#CCA700` | `#BF8803` | Advertencias |
| `success` | `#2EA043` | `#388A34` | OK, conexión activa |

**Colores de entorno** (D10), usados en el punto de la conexión, borde superior de 2 px de la pestaña del editor y el segmento izquierdo de la status bar:

| Entorno | Color |
|---|---|
| Local | `#2EA043` verde |
| Desarrollo | `#3794FF` azul |
| QA / Test | `#CCA700` ámbar |
| Producción | `#F85149` rojo — además la status bar entera se tiñe con fondo `#5A1D1D` (oscuro) / `#FDE7E9` (claro) |

## 3. Tipografía y métricas
- UI: `"Segoe UI", system-ui, -apple-system, sans-serif`, **13 px**, line-height 22 px en listas.
- Código y grilla: `"Cascadia Code", Consolas, "Courier New", monospace`, **13 px** (editor) y **12 px** (grilla), configurable.
- Encabezados de sección de la side bar: 11 px, MAYÚSCULAS, `fg.muted`, peso 600, letter-spacing 0.5px.
- Altura de fila: árbol 22 px, grilla 24 px, pestañas 35 px, toolbars 30 px.
- Iconos: Codicons 16 px.
- Radio de borde: 2 px en inputs y botones, 4 px en menús/diálogos, 0 en paneles.

## 4. Title bar (35 px)
- Ventana sin marco; controles de ventana propios a la derecha (estilo Windows 11: 46 px de ancho cada uno, cerrar se pone rojo `#C42B1C` al hover).
- El título de la ventana (barra de tareas) es `<espacio de trabajo> — DB Explorer`.
- Izquierda: icono de la app (16 px) + menú textual: **Archivo, Editar, Ver, Consulta, Ayuda**. Al hacer clic se abre un menú desplegable estilo VS Code (fondo `bg.menu`, sombra suave, atajos alineados a la derecha en `fg.muted`).
- Centro: caja "command center" (ancho 38%, máx. 600 px, alto 24 px, fondo `bg.input`, texto `fg.muted` "Buscar objetos, archivos o comandos (Ctrl+P)"). Clic → abre la paleta rápida.
- La zona vacía es arrastrable.

### Contenido de menús
- **Archivo**: Nuevo script SQL (Ctrl+N), Abrir archivo… (Ctrl+O), Cambiar espacio de trabajo…, Abrir espacio reciente ▸, —, Guardar (Ctrl+S), Guardar como… (Ctrl+Shift+S), Guardar todo (Ctrl+K S), Guardado automático ✓, — , Nueva conexión…, — , Preferencias (Ctrl+,), Atajos de teclado (Ctrl+K Ctrl+S), — , Salir.
- **Editar**: Deshacer, Rehacer, —, Cortar, Copiar, Pegar, —, Buscar (Ctrl+F), Reemplazar (Ctrl+H), —, Formatear SQL (Shift+Alt+F), Alternar comentario (Ctrl+/).
- **Ver**: Paleta de comandos (Ctrl+Shift+P), —, Conexiones (Ctrl+Shift+D), Archivos (Ctrl+Shift+E), Historial, —, Mostrar/ocultar barra lateral (Ctrl+B), Mostrar/ocultar resultados (Ctrl+J), Maximizar resultados, —, Tema ▸ (Oscuro / Claro / Sistema), Zoom +/−/restablecer.
- **Consulta**: Ejecutar sentencia (Ctrl+Enter), Ejecutar script (Alt+X / F5), Ejecutar selección, Cancelar (Alt+Pausa / Ctrl+Shift+Q), Separador de sentencias ▸ (Línea en blanco / Punto y coma ✓), —, Commit (Ctrl+Alt+C), Rollback (Ctrl+Alt+R), Modo auto-commit ✓, —, Explicar plan (Ctrl+Alt+E), Cambiar conexión activa… (Ctrl+9), Cambiar base/esquema… (Ctrl+0).
- **Ayuda**: Atajos de teclado, Acerca de.

## 5. Activity bar (48 px) — D5
Iconos verticales centrados, 24 px, `fg.muted`; activo en `fg` con barra izquierda de 2 px en `border.focus`.
1. `codicon-database` — **Conexiones** (Ctrl+Shift+D)
2. `codicon-files` — **Archivos** (Ctrl+Shift+E)
3. `codicon-history` — **Historial** (opcional en v1; si no, va como pestaña del panel de resultados)

Abajo: `codicon-settings-gear` → menú con Preferencias, Atajos de teclado, Tema.
Clic en el icono activo colapsa la side bar (como VS Code).

## 6. Side bar — vista Conexiones

### Cabecera (35 px)
Título "CONEXIONES" a la izquierda. Acciones a la derecha (visibles siempre, 16 px, hover con fondo `bg.hover`):
`codicon-add` Nueva conexión · `codicon-new-folder` Nueva carpeta · `codicon-refresh` Refrescar · `codicon-collapse-all` Colapsar todo · `codicon-ellipsis` Más (filtrar por entorno, mostrar objetos del sistema).

### Filtro
Input de 24 px bajo la cabecera, placeholder "Filtrar (tablas, vistas…)", icono `codicon-filter`. Filtra nodos ya cargados y resalta coincidencias en `accent`. `Esc` limpia.

### Árbol
Indentación 8 px por nivel + chevron (`codicon-chevron-right/down`). Guías de indentación verticales de 1 px en `border` visibles al hover del árbol (como VS Code).

Nodos y sus iconos:
| Nivel | Icono | Texto | Texto secundario (`fg.muted`, itálica) |
|---|---|---|---|
| Carpeta de conexiones | `codicon-folder` | nombre | — |
| Conexión | punto de color de entorno (8 px) + icono de motor (16 px, logo simplificado monocromo) | nombre | `host:puerto` o nombre de archivo |
| Base de datos | `codicon-database` | nombre | tamaño opcional |
| Esquema | `codicon-symbol-namespace` | nombre | — |
| Carpeta de tipo | `codicon-folder` | "Tablas", "Vistas", "Funciones", "Procedimientos", "Secuencias" | cantidad entre paréntesis |
| Tabla | `codicon-table` | nombre | filas estimadas opcional |
| Vista | `codicon-eye` | nombre | — |
| Función / Proc. | `codicon-symbol-method` | nombre(args) | tipo de retorno |
| Columna | `codicon-symbol-field` (PK: `codicon-key` en `warning`) | nombre | `tipo` · `NOT NULL` |
| Índice | `codicon-list-tree` | nombre | columnas |

Estados de la conexión: desconectada (icono de motor al 50% de opacidad), conectando (spinner `codicon-loading` girando en lugar del chevron), conectada (normal), error (`codicon-error` en rojo a la derecha, tooltip con el mensaje).

Interacciones:
- Doble clic en conexión → conecta y expande.
- Doble clic en tabla/vista → abre pestaña de **objeto** (sección 9) en la subpestaña "Datos".
- Clic central o Ctrl+Enter en tabla → nuevo script con `SELECT * FROM <tabla> LIMIT 500` (sintaxis según motor).
- Arrastrar tabla o columna al editor → inserta el nombre calificado y entrecomillado según dialecto.
- Teclado: flechas, ←/→ colapsa/expande, Enter abre, F2 renombra (conexiones y carpetas), Supr elimina conexión (con confirmación), F5 refresca nodo.

Menú contextual de **conexión**: Conectar / Desconectar, Nuevo script SQL (Ctrl+]), —, Editar conexión… (F4), Duplicar, Renombrar (F2), Mover a carpeta ▸, Eliminar, —, Refrescar, Copiar nombre.
Menú contextual de **tabla**: Ver datos, Ver estructura, Nuevo script ▸ (SELECT, INSERT, UPDATE, DELETE, DDL), —, Copiar nombre, Copiar nombre calificado, —, Refrescar, Contar filas.

## 7. Side bar — vista Archivos (ver `07`)
Cabecera "ARCHIVOS" + nombre del **espacio de trabajo** como sección colapsable (estilo "EXPLORER › MI-CARPETA" de VS Code); tooltip con la ruta completa. En el menú `codicon-ellipsis` de la cabecera: *Cambiar espacio de trabajo…* y *Abrir en el Explorador*. Acciones al hover de la sección: `codicon-new-file`, `codicon-new-folder`, `codicon-refresh`, `codicon-collapse-all`.

Siempre hay un espacio de trabajo abierto (ver `11`). Si está vacío: mensaje centrado "El espacio de trabajo está vacío" + botón primario **Nuevo script** y enlace *Cambiar espacio de trabajo…*.

Árbol de archivos igual al de VS Code: iconos por tipo (`.sql` con icono de base de datos pequeño, `.json`, `.md`, `.csv`, genérico), archivo abierto en el editor resaltado, archivo con cambios sin guardar con punto a la derecha. Renombrar en línea con input en el mismo nodo.

## 8. Editor group

### Pestañas (35 px)
- Pestaña: icono (16 px) + nombre + botón cerrar `codicon-close` (visible al hover o si está activa). Con cambios sin guardar: `●` en lugar de la ✕ (como VS Code).
- Pestaña activa: fondo `bg.tabActive`, borde superior 1 px `border.focus`, texto `fg`. Inactiva: `bg.tabInactive`, texto `fg.muted`, separador derecho 1 px `border`.
- **Borde superior de 2 px** con el color de entorno de la conexión asociada (reemplaza al borde `border.focus` de la pestaña activa; sin entorno se mantiene el de foco).
- Tipos de pestaña y su icono: Script SQL (`codicon-file-code`), Objeto/tabla (`codicon-table`), Archivo no SQL (`codicon-file`), Preferencias (`codicon-settings`).
- Nombre de pestaña: script = nombre del archivo (`Script-3.sql` se muestra como "Script-3"; todo script es un archivo, ver `11`); objeto = nombre de tabla. Tooltip: ruta o `conexión › base › esquema › tabla`.
- Pestaña en cursiva = *preview* (se reemplaza al abrir otra desde el árbol, como VS Code); doble clic la fija.
- Al desbordar: scroll horizontal con rueda + botón `codicon-ellipsis` "Mostrar pestañas abiertas".
- Arrastrables para reordenar. Clic central cierra. Menú contextual: Cerrar, Cerrar otras, Cerrar a la derecha, Cerrar guardadas, Cerrar todas, Copiar ruta, Mostrar en Archivos.
- Opcional v1: dividir editor en dos grupos lado a lado (Ctrl+\). Si complica, dejar para v2.

### Barra del editor SQL (30 px, fondo `bg.editor`, borde inferior `border`)
De izquierda a derecha:
1. `codicon-play` **Ejecutar sentencia** (Ctrl+Enter) — verde `success`.
2. `codicon-run-all` **Ejecutar script** (Alt+X).
3. `codicon-debug-stop` **Cancelar** — rojo, solo habilitado durante ejecución.
4. `codicon-lightbulb` Explicar plan.
5. Separador vertical.
6. **Selector de conexión**: chip con punto de color + nombre de conexión + `codicon-chevron-down`. Abre lista filtrable de conexiones.
7. **Selector de base** (si el motor lo soporta) y **selector de esquema** (si aplica): chips iguales.
8. Separador.
9. **Modo de transacción**: chip "Auto" / "Manual". En Manual aparecen `codicon-check` **Commit** y `codicon-discard` **Rollback**, y un contador "3 sentencias pendientes" en `warning`.
10. A la derecha: `codicon-symbol-keyword` Formatear, `codicon-layout-panel` Mostrar/ocultar resultados.

Durante la ejecución: barra de progreso indeterminada de 2 px en `accent` bajo la barra del editor, y el cronómetro "00:03.2" junto a Cancelar.

### Área Monaco
- Fondo `bg.editor`, números de línea, minimapa **desactivado por defecto** (configurable), guías de indentación, resaltado de línea actual.
- **Sentencia activa** (la que se ejecutaría con Ctrl+Enter): fondo muy sutil `rgba(0,120,212,0.06)` en su rango y una barra de 2 px en `accent` en el margen izquierdo (gutter).
- Errores de ejecución: subrayado ondulado rojo en la posición que devuelve el motor + marcador en el gutter; hover muestra el mensaje.
- Tras ejecutar, en el gutter de la línea de inicio de cada sentencia: `codicon-pass` verde (ok) o `codicon-error` rojo, que se limpian al editar.
- Widget de autocompletado, hover y find/replace con estilos nativos de Monaco del tema correspondiente.
- **Menú contextual del editor**: el de la app (mismo estilo que los demás menús, con borde y sombra), no el de Monaco: Cambiar todas las ocurrencias (Ctrl+F2), —, Ejecutar sentencia, Ejecutar script, Ejecutar selección, Separador de sentencias ▸, —, Nuevo script SQL, —, Cortar, Copiar, Pegar, —, Paleta de comandos.

## 9. Pestaña de objeto (tabla/vista)
Barra superior con breadcrumb `PayBox Prod › paybox › public › CRendiciones_Conf_Generales` y subpestañas tipo "pill" pequeñas: **Datos** · **Estructura** · **DDL**.
- **Datos**: arriba un input de una línea con Monaco en modo SQL (con autocompletado de columnas) etiquetado `WHERE` y otro `ORDER BY`; debajo la grilla (misma que resultados, editable según D7).
- **Estructura**: tres tablas simples: Columnas (#, nombre, tipo, nulo, default, PK, comentario), Índices, Claves/Restricciones.
- **DDL**: Monaco de solo lectura con el DDL + botón "Abrir en script".

## 10. Panel de resultados
Ocupa por defecto el 40% inferior del grupo de editor. Se asocia a la pestaña SQL activa (cada script conserva sus propios resultados).

### Pestañas del panel (30 px)
`Resultado 1`, `Resultado 2`… (una por cada result set; el nombre se reemplaza por el nombre de la tabla principal cuando se detecta, p. ej. `CRendiciones_Conf_Generales`), **Mensajes** (NOTICE/PRINT, filas afectadas, errores con hora y duración), **Historial** (si no está en la activity bar).
Pestaña de resultado con error: icono `codicon-error` rojo. Botón de fijar resultado (`codicon-pin`) para que no se reemplace en la siguiente ejecución.
Derecha: `codicon-chevron-up` maximizar panel, `codicon-close` ocultar.

### Toolbar de resultados (30 px)
- Input de filtro rápido "Filtrar resultados…" (filtra en cliente, todas las columnas; ancho flexible).
- `codicon-refresh` Re-ejecutar.
- Grupo de edición (solo si hay cambios): `codicon-save` **Guardar (n)** botón primario pequeño, `codicon-discard` Descartar, `codicon-eye` Ver SQL.
- `codicon-add` Agregar fila, `codicon-trash` Eliminar filas (si editable).
- `codicon-export` **Exportar ▾** (CSV, JSON, XLSX, SQL INSERT, Copiar como Markdown, —, **Copiar tabla**, **Copiar tabla (con cabeceras)**). Las dos últimas copian al portapapeles la tabla completa sin importar la selección (ver `06` §Copiar y exportar).
- A la derecha: "Límite" select `500 ▾` (100, 500, 1000, 5000, Todo).

### Grilla
- Cabecera 26 px, fondo `bg.gridHeader`: icono pequeño del tipo lógico (`123` numérico, `abc` texto, `codicon-calendar` fecha, `codicon-json` json, `codicon-check` booleano, `codicon-key` si es PK) + nombre en negrita 600 + botón de orden ▲▼ a la derecha (visible al hover y siempre que la columna esté ordenada; clic alterna ascendente → descendente → sin orden). Tooltip: tipo nativo completo, tabla origen.
- Columna de número de fila fija a la izquierda (40 px, `fg.muted`, alineada derecha).
- Números alineados a la derecha, texto a la izquierda, booleanos centrados como `☑/☐` o `true/false` según config.
- `NULL` en `fg.null` itálica.
- Texto largo truncado con `…`; JSON en una línea con resaltado mínimo.
- Selección tipo hoja de cálculo. Celda con foco con borde 1 px `border.focus`; celdas seleccionadas con fondo `bg.selection`, y el número de fila / cabecera de columna seleccionados resaltados.
  - **Celdas**: clic, arrastre, Shift+clic (rango), Shift+flechas, Ctrl+clic (agrega o quita celdas o rangos no contiguos).
  - **Filas**: clic en el número de fila; arrastre o Shift+clic para un rango; Ctrl+clic para agregar filas sueltas. Teclado: Shift+Espacio selecciona la fila actual.
  - **Columnas**: clic en la cabecera (fuera del botón de orden); arrastre o Shift+clic para un rango; Ctrl+clic para agregar columnas sueltas. Teclado: Ctrl+Espacio selecciona la columna actual.
  - **Todo**: Ctrl+A o clic en la esquina superior izquierda (sobre los números de fila).
  - **Copiar** (Ctrl+C) y **Copiar con cabeceras** (Ctrl+Shift+C) actúan **solo sobre lo seleccionado** (ver `06` §Copiar y exportar).
- Doble clic o F2 / Enter → edición en línea (según tipo: input, checkbox, selector de fecha simple, o editor de valor para JSON/texto largo).
- Ctrl+Shift+Enter o botón en celda → **Visor de valor** en panel lateral derecho del panel de resultados (300 px, redimensionable): muestra el valor completo en Monaco con lenguaje detectado (json, xml, texto), editable si la celda lo es.
- Menú contextual de celda (actúa sobre la selección; si se hace clic derecho fuera de ella, primero selecciona esa celda): Copiar (Ctrl+C), Copiar con cabeceras (Ctrl+Shift+C), Copiar como ▸ (CSV, TSV, JSON, INSERT, IN (…) lista), Pegar, —, Establecer NULL, Ver valor, —, Filtrar por este valor, Excluir este valor, —, Formato de columna ▸ (ver `06`), Ocultar columna, Ajustar ancho.

### Pie del panel (22 px, `fg.muted`, 12 px)
`500 filas (truncado — Cargar más · Cargar todo)` · `12 ms` · `08:47:07` · a la derecha: suma/prom/min/máx de las celdas numéricas seleccionadas (como Excel), "3 cambios pendientes".

## 11. Status bar (22 px)
Izquierda:
- Segmento con color de entorno (fondo sólido, texto blanco): `codicon-database` + nombre de conexión activa. Clic → cambiar conexión.
- Motor y versión: "PostgreSQL 16.2".
- Base/esquema: "paybox · public".
- Durante ejecución: `codicon-loading` girando + "Ejecutando… 00:03".

Derecha: `Ln 1, Col 38 (12 sel.)` · `codicon-save` `Autoguardado` (clic alterna; ver `11` §4) · `Espacios: 4` · `UTF-8` · `CRLF` · `SQL (PostgreSQL)` · `Auto-commit` / `Manual (3)` · `codicon-bell` notificaciones.

## 12. Diálogo de conexión
Modal centrado 640 × 560, fondo `bg.editor`, borde `border`, radio 4 px, sombra `0 8px 24px rgba(0,0,0,.36)`.

- Título "Nueva conexión" / "Editar conexión".
- Paso 1 (solo en nueva): selector de motor como 4 tarjetas en fila (icono + nombre): PostgreSQL, MariaDB / MySQL, SQLite, SQL Server.
- Paso 2 — formulario en dos columnas con etiquetas encima de los campos (estilo Settings de VS Code):
  - **General**: Nombre, Carpeta (select), Entorno (select con punto de color: Local, Desarrollo, QA, Producción), Color personalizado (opcional).
  - **Servidor** (no SQLite): Host, Puerto (default por motor: 5432, 3306, —, 1433), Base de datos (opcional), Usuario, Contraseña (con ojo para mostrar), checkbox "Guardar contraseña". SQL Server: Instancia (opcional).
  - **SQLite**: Ruta del archivo + botón `codicon-folder-opened` "Examinar…", checkboxes "Solo lectura" y "Crear si no existe".
  - **SSL/TLS** (sección colapsable): Modo (Desactivado / Requerido / Verificar CA / Verificar completo), Certificado CA (archivo), y en SQL Server "Cifrar" y "Confiar en certificado del servidor".
  - **Avanzado** (colapsable): Solo lectura, Confirmar sentencias de escritura (auto en Producción), Timeout de conexión, Timeout de consulta, Parámetros extra (clave=valor).
- Pie: a la izquierda **Probar conexión** (botón secundario; al lado resultado en línea: `codicon-pass` verde "Conectado — PostgreSQL 16.2 (42 ms)" o `codicon-error` rojo con mensaje). A la derecha **Cancelar** (secundario) y **Guardar** (primario `accent`).

## 13. Paleta rápida (Ctrl+P / Ctrl+Shift+P)
Estilo quick-open de VS Code: caja de 600 px arriba al centro, input + lista de 22 px por ítem con icono, texto con coincidencias en negrita `accent`, detalle en `fg.muted` a la derecha.
- `Ctrl+P`: busca **objetos de BD** (tablas, vistas, funciones de las conexiones abiertas, usando la caché) y **archivos** del espacio de trabajo. Enter abre.
- `Ctrl+Shift+P` / `F1`: prefijo `>`, **comandos** de la app con su atajo.
- `Ctrl+9`: cambiar conexión de la pestaña. `Ctrl+0`: cambiar base/esquema.

## 14. Diálogos y notificaciones
- Confirmación de escritura en Producción: modal pequeño con borde superior de 3 px rojo, texto "Vas a ejecutar 1 sentencia que modifica datos en **PayBox Prod** (Producción)", vista previa de la sentencia en Monaco solo lectura (máx. 8 líneas), checkbox "No volver a preguntar en esta pestaña", botones **Cancelar** (foco por defecto) y **Ejecutar** (rojo).
- Vista previa de SQL a guardar (ediciones de grilla): modal con Monaco solo lectura con las sentencias generadas y botones Cancelar / Aplicar.
- Notificaciones tipo toast abajo a la derecha (como VS Code): 400 px, icono de severidad, texto, acciones, se apilan y desaparecen a los 8 s salvo errores.

## 15. Preferencias
Pestaña de editor con dos modos (como VS Code): **UI** simple con buscador y lista agrupada (Editor, Archivos, Resultados, Formatos de datos, Conexiones, Apariencia) y botón `codicon-go-to-file` "Abrir settings.json". Cada ajuste: título en negrita, descripción en `fg.muted`, control (checkbox, input, select).

Grupo **Archivos**: espacio de trabajo y guardado automático (ver `11` §5).
Grupo **Formatos de datos** con vista previa en vivo de cada formato (ver `06`).

## 16. Estados vacíos
- Sin conexiones: en la side bar, ilustración mínima con `codicon-database` grande en `fg.muted` + "Aún no hay conexiones" + botón primario **Nueva conexión**.
- Sin pestañas abiertas: fondo del editor con logo tenue y lista de atajos (como la marca de agua de VS Code): Nuevo script `Ctrl+N`, Buscar objeto `Ctrl+P`, Comandos `Ctrl+Shift+P`, Nueva conexión, Cambiar espacio de trabajo.
- Resultados sin ejecutar: texto centrado `fg.muted` "Ejecuta una consulta con Ctrl+Enter".

## 17. Pantallas que debe incluir la maqueta
1. Principal oscura: vista Conexiones con árbol expandido (una conexión de Producción y otra Local), script con 6 consultas, sentencia activa resaltada, resultados con grilla de ~15 filas y 6 columnas de tipos variados (id, texto, fecha, decimal, booleano, NULL), status bar teñida de Producción.
2. Igual, en tema claro.
3. Vista Archivos con el espacio de trabajo "DB Explorer" (subcarpetas y varios `Script-N.sql`), un script abierto sin cambios y otro con ●; status bar con el indicador "Autoguardado".
4. Pestaña de objeto → Datos, con filtro WHERE y celdas editadas (amarillas), una fila nueva (verde), una eliminada (roja) y el botón "Guardar (3)".
5. Diálogo de nueva conexión (PostgreSQL) con "Probar conexión" exitoso.
6. Paleta rápida abierta con búsqueda de tablas.
7. Menú contextual de tabla en el árbol y menú contextual de celda en la grilla.
8. Modal de confirmación de escritura en Producción.
