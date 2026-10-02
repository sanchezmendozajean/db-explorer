# 05 — Editor SQL (Monaco)

Objetivo: que editar SQL aquí se sienta **igual que en VS Code**: mismos atajos, multicursor, búsqueda, plegado y comportamiento de sugerencias.

## Integración
- Paquete `monaco-editor` empaquetado localmente con `vite-plugin-monaco-editor` (o workers configurados manualmente con `?worker`). **Nada desde CDN** (CSP estricta y uso sin internet).
- Workers necesarios: `editor.worker` y `json.worker` (para `settings.json`, visor de JSON). SQL no necesita worker de lenguaje.
- Una instancia de editor por grupo; un `ITextModel` por pestaña con URI del archivo (`file:///C:/…/Script-3.sql`; todo script es un archivo, ver `11`). Guardar y restaurar `viewState` (cursor, scroll, plegados) al cambiar de pestaña.
- Temas: definir `db-dark` y `db-light` con `monaco.editor.defineTheme` a partir de `vs-dark`/`vs` y los tokens de `04-interfaz.md`. El fondo del editor debe coincidir exactamente con `bg.editor`.

## Opciones por defecto (sobrescribibles en settings.json bajo `editor.*`)
```jsonc
{
  "editor.fontFamily": "'Cascadia Code', Consolas, 'Courier New', monospace",
  "editor.fontSize": 13,
  "editor.fontLigatures": false,
  "editor.tabSize": 4,
  "editor.insertSpaces": true,
  "editor.wordWrap": "off",
  "editor.minimap.enabled": false,
  "editor.renderWhitespace": "selection",
  "editor.lineNumbers": "on",
  "editor.cursorBlinking": "smooth",
  "editor.smoothScrolling": true,
  "editor.bracketPairColorization.enabled": true,
  "editor.guides.indentation": true,
  "editor.folding": true,
  "editor.quickSuggestions": { "other": true, "comments": false, "strings": false },
  "editor.suggestOnTriggerCharacters": true,
  "editor.acceptSuggestionOnEnter": "on",
  "editor.formatOnPaste": false,
  "editor.stickyScroll.enabled": false,
  "editor.multiCursorModifier": "alt"
}
```
Todas las opciones de `IEditorOptions` de Monaco se aceptan tal cual (se pasan directo con `updateOptions`), así el usuario puede copiar ajustes de su `settings.json` de VS Code.

## Atajos

### Heredados de Monaco (no reimplementar, solo verificar que no se pisen)
| Acción | Atajo |
|---|---|
| Multicursor en siguiente coincidencia | Ctrl+D |
| Seleccionar todas las coincidencias | Ctrl+Shift+L |
| Cursor arriba/abajo | Ctrl+Alt+↑ / ↓ |
| Cursor con clic | Alt+Clic |
| Selección en bloque | Shift+Alt+arrastrar |
| Mover línea | Alt+↑ / ↓ |
| Copiar línea | Shift+Alt+↑ / ↓ |
| Borrar línea | Ctrl+Shift+K |
| Insertar línea debajo/arriba | Ctrl+Enter / Ctrl+Shift+Enter *(ver conflicto abajo)* |
| Comentar línea / bloque | Ctrl+/ · Shift+Alt+A |
| Indentar / desindentar | Ctrl+] / Ctrl+[ · Tab / Shift+Tab |
| Buscar / reemplazar | Ctrl+F / Ctrl+H, F3 / Shift+F3 |
| Expandir / reducir selección | Shift+Alt+→ / ← |
| Plegar / desplegar | Ctrl+Shift+[ / ] · Ctrl+K Ctrl+0 / Ctrl+K Ctrl+J |
| Ir a línea | Ctrl+G |
| Sugerencias | Ctrl+Espacio |
| Paleta de comandos del editor | F1 (se redirige a la paleta de la app, ver abajo) |
| Transformar a mayúsculas/minúsculas | Ctrl+K Ctrl+U / Ctrl+K Ctrl+L (agregar como acciones si no vienen) |

### Propios de la app (registrados con `editor.addAction` o a nivel ventana)
| Acción | Atajo | Nota |
|---|---|---|
| Ejecutar sentencia bajo el cursor o selección | **Ctrl+Enter** | Pisa "insertar línea debajo" de Monaco; esa acción queda en Ctrl+Alt+Enter. Es el estándar de clientes SQL. |
| Ejecutar script completo | **Alt+X** y **F5** | Si hay selección, ejecuta solo la selección como script. |
| Ejecutar en nueva pestaña de resultado | **Ctrl+Alt+Shift+Enter** | Mantiene resultados previos. |
| Cancelar ejecución | **Ctrl+Shift+Q** y Alt+Pausa | |
| Explicar plan | **Ctrl+Alt+E** | Ctrl+Shift+L se deja a Monaco ("seleccionar coincidencias"). Ver `12`. |
| Explicar y ejecutar (plan real) | **Ctrl+Alt+Shift+E** | Ejecuta la sentencia; las escrituras se revierten (`12` §4). |
| Formatear SQL | **Shift+Alt+F** | `sql-formatter` con el dialecto de la conexión. Formatea selección si la hay. |
| Commit / Rollback | Ctrl+Alt+C / Ctrl+Alt+R | Solo en modo manual. |
| Guardar / Guardar como | Ctrl+S / Ctrl+Shift+S | Guardar como → diálogo nativo, inicia en el espacio de trabajo. |
| Nuevo script (conexión actual) | Ctrl+N | Crea `Script-N.sql` en el espacio de trabajo y lo asocia a la conexión seleccionada en el árbol o a la de la pestaña activa. |
| Cerrar pestaña | Ctrl+W / Ctrl+F4 | |
| Reabrir pestaña cerrada | Ctrl+Shift+T | |
| Siguiente/anterior pestaña | Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+PgDn / PgUp | |
| Ir a pestaña N | Alt+1…9 | |
| Paleta de comandos | Ctrl+Shift+P, F1 | Paleta de la app, incluye las acciones del editor. |
| Abrir rápido (objetos y archivos) | Ctrl+P | |
| Cambiar conexión / base-esquema | Ctrl+9 / Ctrl+0 | |
| Barra lateral | Ctrl+B | |
| Panel de resultados | Ctrl+J | |
| Maximizar resultados | Ctrl+Shift+J | |
| Foco: editor / resultados / árbol | Ctrl+1 / Ctrl+2 / Ctrl+Shift+D | |
| Vista Archivos | Ctrl+Shift+E | |
| Preferencias | Ctrl+, | |
| Zoom | Ctrl+= / Ctrl+- / Ctrl+NumPad0 | Zoom de toda la UI (webContents). |
| Abrir definición de tabla bajo cursor | F12 | Abre la pestaña de objeto. |
| Ver estructura en hover | (hover) | Hover sobre una tabla muestra sus columnas. |

> Esta tabla es la fuente de verdad de los atajos; los menús de `04-interfaz.md` deben mostrar los mismos.

### Personalización
- `keybindings.json` en `userData` con formato compatible con VS Code:
  ```json
  [{ "key": "ctrl+e", "command": "db.executeStatement", "when": "editorTextFocus" }]
  ```
- Soportar `key`, `command`, `when` (contextos mínimos: `editorTextFocus`, `resultsFocus`, `treeFocus`, `isProduction`) y comandos negados con `-` (`"command": "-db.executeStatement"`) para quitar un atajo.
- Todos los comandos tienen un id estable `db.*` listado en la paleta.
- Las acciones propias de Monaco se exponen con su id (`editor.action.copyLinesDownAction`, etc.) para que puedan re-asignarse igual que en VS Code.

## Lenguaje y resaltado
- Base: lenguaje `sql` de Monaco. Registrar variantes `pgsql`, `mysql`, `tsql`, `sqlite` (Monaco ya trae `pgsql`, `mysql`, `sql`; para T-SQL usar `sql` + palabras extra). El lenguaje del modelo cambia según la conexión de la pestaña.
- Archivos `.sql` sin conexión asociada: lenguaje `sql` genérico.

## Autocompletado (`registerCompletionItemProvider`)
Fuente: `CompletionCatalog` cacheado por conexión/base/esquema (ver `03`), cargado en segundo plano al conectar o al cambiar esquema.

Contexto mínimo que debe entender (análisis ligero con tokens, sin parser completo):
- Después de `FROM`, `JOIN`, `UPDATE`, `INTO`, `TABLE` → tablas y vistas (y esquemas, que al elegir insertan `esquema.`).
- Después de `esquema.` → objetos de ese esquema.
- Después de `alias.` o `tabla.` → columnas de esa tabla, resolviendo alias declarados en la sentencia actual (`FROM clientes c`, `JOIN pedidos AS p`).
- En `SELECT`, `WHERE`, `ON`, `GROUP BY`, `ORDER BY`, `SET` → columnas de las tablas presentes en la sentencia + funciones + palabras clave.
- Siempre: palabras clave y funciones del dialecto.
- Entrecomillado automático cuando el nombre lo requiere (mayúsculas en Postgres → `"CRendiciones_Conf_Generales"`, espacios, palabras reservadas) con el carácter del dialecto (`"`, `` ` ``, `[ ]`).
- Detalle de ítem: tipo de columna, `PK`, tabla de origen. Documentación: lista de columnas para tablas.
- Snippets: `sel` → `SELECT * FROM $1 $0`, `ins`, `upd`, `del` (con `WHERE` obligatorio), `cte`.

Otros providers:
- **Hover**: tabla → columnas con tipos; columna → tipo, nulo, default.
- **Definition (F12)**: abre pestaña de objeto. *Hasta M7 (pestaña de objeto real) selecciona la tabla en el árbol de conexiones.*
- **Markers**: errores devueltos por el motor en la posición indicada.

## Sentencia activa y ejecución
- **Separador de sentencias** (menú Consulta y menú contextual del editor; preferencia `sql.statementSeparator`): **Punto y coma** (por defecto) o **Línea en blanco**. Con "Línea en blanco", una línea vacía también separa sentencias (el `;` sigue separando); las líneas vacías dentro de cadenas, comentarios de bloque, *dollar quoting* o `BEGIN ATOMIC … END` no cuentan, y una línea con solo un comentario no es una línea en blanco.
- Al mover el cursor (debounce 150 ms) se calcula con `splitter/` la sentencia que contiene el cursor; si el cursor está en una línea vacía entre dos sentencias, se toma la anterior. Se decora como se describe en `04` §8.
- El splitter corre en el renderer (misma implementación compartida en `src/shared/splitter`) para que sea instantáneo.
- Parámetros: si la sentencia contiene `:nombre` o `?` fuera de strings/comentarios (según config), pedir valores en un diálogo pequeño antes de ejecutar (opcional v1; por defecto desactivado, `sql.parameters.enabled`).

## Guardado y sesión
Definido en `11-scripts-y-espacio-de-trabajo.md`: todo script es un archivo en el espacio de trabajo, guardado automático (5 s sin escribir, al ejecutar y al cerrar), restauración de pestañas al abrir y detección de cambios externos.
- Antes de ejecutar, el comando de ejecución llama a `autosave.flush(tab)` y espera a que termine (o falle) cuando el guardado automático está activo.
