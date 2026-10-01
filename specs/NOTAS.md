# Notas de implementación

Registro de decisiones tomadas durante la construcción, desvíos respecto a las specs y pendientes.

---

## M0 — Esqueleto (2026-09-30)

### Estado
Completado. Criterios de aceptación verificados:

| Criterio | Resultado |
|---|---|
| `npm run dev` abre una ventana | ✅ Verificado con captura de pantalla |
| El renderer muestra la respuesta de `ping` al db-host | ✅ Muestra eco, PID del db-host, ida y vuelta, versiones |
| `npm test` pasa | ✅ 14 pruebas unitarias |
| `npm run lint` pasa | ✅ ESLint + chequeo de tipos (main/preload/db-host, renderer, e2e) |
| Extra: `npm run test:e2e` | ✅ 4 pruebas Playwright sobre el build: ping, renderer sin Node, bloqueo de `window.open`/navegación, CSP sin scripts inline |

### Versiones elegidas
- Electron 44, electron-vite 5, Vite 7, React 19, TypeScript 5.9, zod 4, Vitest 5, ESLint 10, Playwright 1.63.
- **Vite 7 y no 8**: electron-vite 5 solo admite Vite ≤ 7.
- **TypeScript 5.9 y no 7**: typescript-eslint exige TypeScript < 6.1.

### Decisiones
- **Canal main ↔ db-host**: se usa `process.parentPort` del `utilityProcess` (que es un `MessagePort`) en lugar de un `MessageChannelMain` explícito. Es lo más simple y no bloquea pasar puertos dedicados más adelante (p. ej. para el streaming de filas en M3).
- **Contrato IPC**: `src/shared/ipc.ts` define los canales con esquemas zod; los nombres viven aparte en `src/shared/channels.ts` para que el preload (sandbox, sin `require` de dependencias) no arrastre zod.
- **Respuestas IPC envueltas**: todo `invoke` devuelve `IpcResult<T>` (`{ ok, data } | { ok, error: { code, message } }`); nunca se propagan excepciones por el puente.
- **Validación del emisor**: main rechaza peticiones cuyo `senderFrame.url` no sea el renderer propio (servidor de desarrollo o `index.html` empaquetado).
- **Reinicio del db-host**: si se cae, main rechaza las peticiones pendientes, lo reinicia (máximo 5 veces por minuto) y emite `app:db-host-restarted`; el renderer muestra "Conexiones reiniciadas".
- **CSP**: se inyecta como `<meta>` con un plugin de Vite. En build es exactamente la de `08` (+ `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`). En desarrollo se añaden `'unsafe-inline'` en `script-src` (preámbulo de React Refresh) y `ws://localhost:*` en `connect-src` (HMR). Queda pendiente verificar en M3 si Monaco necesita algo más.
- **Permisos del navegador**: se deniegan todas las solicitudes de permisos (cámara, notificaciones, etc.) y se bloquean `<webview>`.
- **Ventana**: en M0 se usa el marco nativo; la title bar propia llega en M1.
- **`ELECTRON_RUN_AS_NODE`**: las terminales integradas de VS Code exportan `ELECTRON_RUN_AS_NODE=1`, lo que hace arrancar Electron como Node. `npm run dev`/`preview` pasan por `scripts/electron-vite.mjs`, que elimina la variable; las pruebas e2e también la eliminan.
- **npm 11 `allowScripts`**: se aprobaron los scripts de instalación de `esbuild` y `electron-winstaller`. Electron 44 descarga su binario en el primer uso (o con `node node_modules/electron/install.js`).

### Pendientes / avisos
- **Docker no está instalado** en este equipo: `test/integration/docker-compose.yml` (Postgres 16, MariaDB 11, SQL Server 2022) está listo pero no se ha levantado. `npm run test:integration` pasa sin pruebas hasta M2.
- `npm run package` tiene una configuración mínima de `electron-builder` (NSIS + portable); no se ha ejecutado. Fuses, iconos y nombre final se hacen en M9.
- El bundle del renderer pesa ~645 kB sin minificar por dividir; se revisará al medir arranque en M9.

---

## M1 — Shell visual (2026-09-30)

### Estado
Completado con datos falsos (tomados de `specs/maqueta`). Criterios de aceptación verificados:

| Criterio | Resultado |
|---|---|
| La app se ve como la maqueta (pantallas 1 y 2) | ✅ Comparado con capturas a 1600×1000 en tema oscuro y claro (también vista Archivos, pestaña de objeto, paleta y menús) |
| Ctrl+B, Ctrl+J, cambio de tema y paleta funcionan | ✅ Prueba e2e `shell.spec.ts` |
| Tamaños de paneles se recuerdan al reiniciar | ✅ Prueba e2e: arrastra el sash, reinicia la app con el mismo `userData` y compara (±3 px); también el tema |
| Pruebas | ✅ 47 unitarias, 14 e2e; lint y tipos limpios |

### Qué se construyó
- **Ventana sin marco** con title bar propia: menú (Archivo, Editar, Ver, Consulta, Ayuda) con submenús y navegación por teclado (←/→ entre menús), command center y controles de ventana estilo Windows 11. Sin menú nativo (`Menu.setApplicationMenu(null)`); en desarrollo, Ctrl+Shift+I abre las DevTools.
- **Activity bar**, **side bar** (Conexiones, Archivos, Historial), **grupo de editor** con pestañas, **panel de resultados** y **status bar** (teñida en Producción).
- **Tokens de tema** exactos de `04` §2 en `theme/tokens.css`. Los que no están en la tabla (borde de inputs y menús, colores de sintaxis, íconos de tabla/SQL) se tomaron de la maqueta y están marcados como "(maqueta)".
- **Componentes base** en `renderer/components`: `Button`/`IconButton`, `TextInput`, `Select`, `Checkbox`, `Menu` (submenús, teclado, se reposiciona si no cabe), `Dropdown`, `Modal` (foco atrapado), `Toasts`, `VirtualTree` (virtualizado, teclado completo, guías de indentación al hover), `Tabs`.
- **Registro central de comandos** (`commands/registry.ts`) y **sistema de atajos** (`commands/keybindings.ts`): sintaxis de VS Code, acordes de dos pasos (`ctrl+k s`), cláusulas `when` (`!`, `&&`, `||`), la última regla gana y `-comando` quita atajos (listo para `keybindings.json` en M6).
- **Paleta rápida**: Ctrl+Shift+P / F1 (comandos, prefijo `>`) y Ctrl+P (objetos y archivos) con búsqueda difusa y resaltado.
- **Estados vacíos** de `04` §16: marca de agua sin pestañas (se ve al cerrar todas), "Ejecuta una consulta con Ctrl+Enter" en resultados (Script-1), "Aún no hay conexiones" y "El espacio de trabajo está vacío" (en `npm run dev`, comando de paleta *Desarrollo: Alternar datos de ejemplo*).
- **`ui-state.json`**: tema, vista y visibilidad de la barra lateral, panel visible/maximizado y tamaños. Validado con zod campo por campo (un archivo parcialmente dañado conserva lo válido) y escrito de forma atómica.
- **Fuentes e íconos empaquetados**: Codicons (`@vscode/codicons`) y Cascadia Code (`@fontsource/cascadia-code`, licencia OFL, subconjunto latino 400/400 itálica/600) van dentro del build. Una prueba e2e verifica que no se carga ningún recurso remoto y que ambas fuentes están disponibles.

### Decisiones
- **Segoe UI no se empaqueta**: su licencia de Microsoft no permite redistribuirla. Se usa la del sistema (presente en todo Windows, plataforma objetivo según D12), con `system-ui` como respaldo. Nunca se descarga nada.
- **Placeholder del command center**: se usa "Buscar en *DB Explorer*…" de `11` §2 (prevalece por número mayor sobre "Buscar objetos, archivos o comandos (Ctrl+P)" de `04` §4, que queda como tooltip).
- **Atajo que muestran los menús**: el primero declarado para el comando (p. ej. Ctrl+Shift+P antes que F1, Ctrl+W antes que Ctrl+F4). Al implementar `keybindings.json` (M6), los atajos del usuario deberán tener prioridad de visualización.
- **Zoom en teclados españoles**: además de `ctrl+=` se registran `ctrl++`, `ctrl+shift+=`, `ctrl+shift++` y los del teclado numérico, porque en la distribución española "=" requiere Shift.
- **Comandos de hitos posteriores**: sus atajos están en la tabla por defecto, pero mientras el comando no exista no consumen la tecla y los menús los muestran deshabilitados. Los botones visibles en la maqueta (Ejecutar, Exportar, Nueva conexión, etc.) muestran un aviso "todavía no está disponible".
- **Editor y grilla provisionales**: el área del editor es una vista estática con resaltado (Monaco llega en M3) y la grilla es una tabla HTML (Glide Data Grid llega en M3). Viven en `CodePreview.tsx` y `ResultsGrid.tsx` para reemplazarlos sin tocar el layout.
- **Pestaña de objeto**: ocupa todo el grupo de editor (breadcrumb, WHERE/ORDER BY, grilla), sin panel de resultados inferior, como la pantalla 4 de la maqueta.
- **`DBX_USER_DATA_DIR`**: variable solo para builds no empaquetados; aísla `userData` en las pruebas e2e.
- **Lint**: se desactivó `@typescript-eslint/no-non-null-assertion`. Con `noUncheckedIndexedAccess` el compilador ya exige verificar accesos, y `!` tras comprobar límites es legítimo.
- **Tamaño de la barra lateral**: por defecto 280 px, mínimo 170 px; conserva su ancho en píxeles al redimensionar la ventana. Doble clic en un sash restaura el tamaño por defecto (comportamiento de `react-resizable-panels`).

### Pendientes / avisos
- Los datos de ejemplo (`renderer/sample/`, `stores/sample-store.ts`) se eliminan a medida que lleguen datos reales (M2 conexiones, M3 editor/resultados, M5 archivos).
- No se persiste el tamaño/posición de la ventana (no lo pide la spec); se puede añadir a `ui-state.json` si se desea.
- El bundle del renderer pesa ~1,1 MB sin dividir; se revisará en M9.

---

## Cambio de alcance solicitado (2026-09-30): selección y copia en la grilla

Pedido del usuario: seleccionar celdas, filas y columnas; Ctrl+C / Ctrl+Shift+C copian solo lo seleccionado; en Exportar, "Copiar tabla" y "Copiar tabla (con cabeceras)". Pertenece a **M3** (la grilla actual de M1 es provisional), así que solo se actualizó la documentación: `04` §10, `06` §Copiar y exportar y `09` (tareas y aceptación de M3).

Definiciones que faltaban (se eligió lo más simple, compatible con Excel y DBeaver):
- **Clic en la cabecera selecciona la columna**; el orden pasa a un botón ▲▼ dentro de la cabecera (antes la spec no aclaraba qué hacía el clic en la cabecera).
- **Selección no rectangular**: se copian las filas y columnas que tienen alguna celda seleccionada; las celdas no seleccionadas dentro de ese contorno van vacías, para que cada valor caiga en su columna al pegar.
- **Copiar tabla**: todas las filas *cargadas* y las columnas visibles, respetando orden y filtro rápido; si el resultado está truncado se avisa con la opción "Cargar todo y copiar".
- `NULL` se copia como cadena vacía (`results.copy.nullAs`); una sola celda se copia sin salto de línea final; confirmación si la selección supera 100 000 celdas.
- En M3 el menú Exportar tendrá habilitadas solo las dos opciones de copiar tabla; CSV/JSON/XLSX/INSERT/Markdown siguen en M7.

---

## M2 — Conexiones + PostgreSQL + árbol (2026-09-30)

### Estado
Completado. Criterios de aceptación verificados:

| Criterio | Resultado |
|---|---|
| Crear, editar, duplicar y borrar conexiones | ✅ e2e `connections.spec.ts` |
| Conectar a PostgreSQL | ✅ contra PostgreSQL 18.6 real (ver "Servidor de pruebas") |
| Navegar bases → esquemas → tablas → columnas | ✅ e2e e integración (también índices, vistas, funciones, secuencias) |
| La contraseña no aparece en texto plano en `userData` | ✅ e2e: recorre todos los archivos de `userData` buscando la contraseña en UTF-8 y UTF-16 |
| Pruebas | ✅ 58 unitarias, 12 de integración, 24 e2e; lint y tipos limpios |

### Qué se construyó
- **Modelo de conexión** de `08` con zod (`shared/connection.ts`) y tipos de metadatos de `03` (`shared/metadata.ts`).
- **`connections.json`**: validado por entrada (las inválidas o duplicadas se omiten con aviso al iniciar), copia `.bak` antes de cada escritura, escritura atómica. Un archivo ilegible se aparta como `connections.json.invalido-<fecha>` en lugar de sobrescribirse.
- **`secrets.bin`**: contraseñas cifradas con `safeStorage` (DPAPI). El renderer solo recibe la lista de ids con contraseña guardada; main descifra y envía la contraseña directo al db-host. Sin "Guardar contraseña", se pide al conectar y solo vive en la memoria del db-host. Si el cifrado no está disponible, el diálogo lo avisa y no guarda contraseñas.
- **Driver PostgreSQL** (`pg`) con metadatos desde `pg_catalog`, una conexión de metadatos por base (Postgres no permite `USE`), `numeric`/`int8`/fechas como texto crudo, SSL (`require`, `verify-ca`, `verify-full` con CA) y `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` en conexiones de solo lectura.
- **Árbol genérico por `capabilities`** (`db-host/tree.ts`): conexión → bases → esquemas (los de sistema agrupados en "Esquemas del sistema") → carpetas con conteo (Tablas, Vistas, Vistas materializadas, Funciones, Procedimientos, Secuencias) → objetos → columnas (tipo, `NOT NULL`, llave en PK) e Índices. Carga perezosa con spinner; errores de carga en el nodo con tooltip.
- **Diálogo de conexión** (`04` §12): tarjetas de motor, General (nombre, carpeta, entorno con punto de color, color personalizado), Servidor o Archivo (SQLite, con "Examinar…"), SSL/TLS y Avanzado (solo lectura, confirmar escrituras —activado automáticamente en Producción—, timeouts, parámetros extra, objetos del sistema). "Probar conexión" con resultado en línea. Al editar, la contraseña guardada se muestra como `••••••••` y solo se envía si se cambia.
- **Carpetas de conexiones**, menús contextuales de carpeta, conexión y tabla, teclado (Enter/doble clic conecta y expande, F2 renombra, Supr elimina con confirmación, F4 edita, F5 refresca), filtro sobre los nodos cargados, filtro por entorno y **arrastrar para reordenar** (conexión sobre carpeta = entra; sobre otra conexión = se ubica antes; carpeta sobre carpeta = reordena).
- **Copiar nombre calificado** con entrecomillado por dialecto (`shared/sql-quote.ts`, reutilizable en M6).

### Decisiones
- **Servidor de pruebas sin Docker**: `test/integration/pg-server.ts` usa el PostgreSQL de `.env` si responde (p. ej. docker-compose) y, si no, crea un **clúster temporal** con los binarios locales (`C:\Program Files\PostgreSQL\<versión>\bin` o `PG_BIN`) en el puerto 55432 con las credenciales de `.env.example`; lo detiene y borra al terminar. No toca el servicio PostgreSQL instalado. Lo usan tanto Vitest (integración) como Playwright (e2e).
- **Interfaz `DbDriver` parcial**: en M2 solo conexión y metadatos (más `countObjects` para los conteos de carpetas). Ejecución, sesiones y transacciones se agregan en M3.
- **Solo PostgreSQL conecta**: las conexiones de MariaDB, SQLite y SQL Server se pueden crear y guardar, pero al conectar o probar muestran "El motor … todavía no está disponible" hasta M4.
- **Contraseña requerida**: si no hay contraseña guardada (o "Guardar contraseña" está desactivado), main responde `password-required` y el renderer abre el diálogo de contraseña, que ofrece guardarla. Tras conectar, el nodo se expande.
- **Renombrar** conexiones y carpetas con un diálogo pequeño en lugar de un input dentro del nodo (más simple; el renombrado en línea queda para el árbol de archivos de M5).
- **"Mostrar objetos del sistema"** es por conexión (en Avanzado, como en `08`); del menú "…" de la cabecera se quitó para no duplicarlo. Ahí queda "Filtrar por entorno".
- **Editar una conexión la desconecta**, para que el siguiente uso tome la nueva configuración.
- **Clic simple en el árbol de conexiones solo selecciona**; se expande con el chevron, las flechas, Enter o doble clic, para que conectar sea siempre explícito.
- Acciones que dependen de hitos posteriores aparecen deshabilitadas en los menús: Nuevo script (M3), Ver datos / Ver estructura (M7), Contar filas (M3).
- `pg_ctl` en Windows: `pg_ctl start` deja al servidor heredando los pipes; se lanza con `stdio: 'ignore'` para no bloquear.

### Pendientes / avisos
- ~~La barra de estado, las pestañas y el editor siguen con datos de ejemplo hasta M3.~~ Resuelto en M3.
- Ctrl+P sigue buscando en objetos de ejemplo; la búsqueda real en la caché de metadatos llega en M6.

## Ajuste visual (2026-09-30): color de entorno en la pestaña

- A pedido del usuario, la línea de color de entorno de la pestaña del editor pasa del borde izquierdo al **borde superior** (2 px). En la pestaña activa con conexión reemplaza al borde de foco de 1 px; sin conexión se mantiene el borde de foco. Actualizado en `specs/04` (§ colores de entorno y § 8).

---

## M3 — Editor + ejecución + grilla (2026-09-30)

### Estado
Completado. Criterios de aceptación verificados:

| Criterio | Resultado |
|---|---|
| Escribir y ejecutar consultas contra Postgres con los atajos de `05` | ✅ e2e `editor.spec.ts` + checklist de atajos (abajo) |
| `SELECT` de 200 000 filas no congela la UI | ✅ e2e (sin límite; la UI sigue pintando cuadros mientras llegan los lotes) e integración (lotes de ≤ 500 filas) |
| Cancelar `SELECT pg_sleep(30)` | ✅ e2e (Ctrl+Shift+Q, menos de 10 s) e integración (la sesión sigue usable) |
| `numeric` y `timestamp` sin pérdida ni cambio de zona | ✅ integración (valores crudos) y e2e (copia al portapapeles exacta) |
| `11` §6 salvo el cambio de espacio de trabajo | ✅ e2e: Ctrl+N crea `Script-N.sql` y aparece en Archivos; guardado a los 5 s y al ejecutar; cerrar la ventana antes de 5 s guarda; al reabrir se restauran pestaña, cursor y conexión; un cambio externo no se pisa; cerrar un script vacío lo elimina |
| Dos columnas no contiguas + Ctrl+Shift+C → solo esas columnas con cabeceras | ✅ e2e |
| "Copiar tabla (con cabeceras)" copia todas las filas con una sola celda seleccionada | ✅ e2e |
| Confirmaciones de Producción y `UPDATE/DELETE` sin `WHERE` | ✅ e2e |
| Pruebas | ✅ 104 unitarias, 26 de integración, 40 e2e; lint, tipos y Prettier limpios |

### Qué se construyó
- **Separador de sentencias** (`src/shared/splitter`): PostgreSQL completo (cadenas, `E'…'`, identificadores, comentarios anidados, *dollar quoting*, `BEGIN ATOMIC … END`), comillas de los demás dialectos, sentencia bajo el cursor y clasificación de escrituras / `UPDATE`-`DELETE` sin `WHERE`.
- **Ejecución en el db-host**: una sesión (conexión física) por pestaña, `pg-cursor` con lotes de 500 filas, límite, "Cargar más" / "Cargar todo", `NOTICE`, errores con posición, detalle y sugerencia, cancelación con `pg_cancel_backend`, `statement_timeout` según el timeout de consulta y esquema por `search_path`.
- **Espacio de trabajo y `settings.json`** en main: `Documentos\DB Explorer` por defecto, `Script-N.sql`, guardado atómico con BOM y fin de línea, detección de cambios externos por `mtime`, estado de pestañas en `userData/workspaces/<sha1>.json` y cierre coordinado con el renderer.
- **Monaco** local (textos en español, worker empaquetado, temas `db-dark` / `db-light` con el fondo de `bg.editor`), un modelo por pestaña con viewState, sentencia activa decorada, marcas ✓/✗ en el gutter y error subrayado en la posición que informa el motor.
- **Grilla Glide** con selección de celdas, filas y columnas (Ctrl/Shift+clic, Shift+Espacio, Ctrl+Espacio, Ctrl+A), copia TSV compatible con Excel, "Copiar tabla", orden en cliente (botón ▲▼ de la cabecera), filtro rápido, ocultar columnas, visor de valor (Ctrl+Shift+Enter), suma/promedio/mín./máx. de la selección y formatos globales básicos de `06`.
- **Barra del editor** con conexión, base y esquema (listas filtrables, Ctrl+9 / Ctrl+0), cronómetro y barra de progreso; **status bar** real (conexión, versión, base · esquema, ejecución, Ln/Col, Autoguardado conmutable, fin de línea, lenguaje).
- Pestaña **Mensajes** (hora, filas, duración, NOTICE, errores con "Ir a la línea"), **Re-ejecutar**, fijar resultados y "Ejecutar en nueva pestaña de resultado".
- Árbol: Nuevo script (menú y Ctrl+]), Nuevo script ▸ SELECT/INSERT/UPDATE/DELETE, clic central o Ctrl+Enter en una tabla, Contar filas y arrastrar tablas o columnas al editor.
- Vista **Archivos** y **Ctrl+P** con los archivos reales del espacio de trabajo (solo listar y abrir).

### Decisiones
- **Glide Data Grid `6.0.4-alpha24`** (versión fija): la estable 6.0.3 declara compatibilidad solo hasta React 18; la beta declara React 19.
- **`dompurify` forzado a ≥ 3.4.16** con `overrides`: Monaco 0.57 trae una versión con un aviso de seguridad.
- **Una sola fuente de íconos**: Monaco declara su propia fuente `codicon`; un alias de Vite reemplaza su `codicon.css` por uno vacío y Monaco usa la de `@vscode/codicons`.
- **Monaco se carga de forma diferida** (chunk aparte) con solo los lenguajes `sql`, `pgsql` y `mysql`.
- **Valores crudos**: en las sesiones de editor todo llega como texto del servidor salvo booleanos y enteros de 32 bits (`03` decía JSON como objeto; como texto no se pierde nada y el visor lo muestra con sangría). Actualizado en `03`.
- **Fin de la ejecución por evento**: la respuesta de `query:execute` y los eventos `query:event` viajan por canales IPC distintos y la respuesta puede llegar antes que los últimos lotes; el db-host emite `execution-done` / `fetch-done` y el renderer termina con ese evento.
- **Cursor abierto solo para el último resultado** de una ejecución: para ejecutar la sentencia siguiente hay que cerrar el cursor anterior, así que un resultado truncado en medio de un script no tiene "Cargar más" (se re-ejecuta).
- **"Cargar todo"** trae hasta 100 000 filas y, si el resultado sigue, pregunta antes de traer el resto (actualizado en `06`).
- **El splitter vive en `src/shared/splitter`** (`05` es más específico que la estructura de `02`, que se actualizó).
- **Canales del espacio de trabajo con prefijo `fs:`** (`fs:open-workspace`, `fs:new-script`…), porque `02` fija los dominios `conn/meta/query/fs/settings/app`.
- **`settings.json`** se lee al iniciar y se modifica conservando comentarios (`jsonc-parser`); en M3 solo lo cambia la app (conmutar Autoguardado). La UI de Preferencias es de M9 y la edición con esquema, de M6.
- **Espacio configurado inexistente**: se usa el predeterminado sin preguntar; el modal "No se encuentra el espacio de trabajo" es de M5.
- **Scripts nuevos con CRLF** (Windows primero, D12); los existentes conservan su fin de línea y BOM.
- **Confirmación de Producción**: usa `confirmWrites` de la conexión (activado por defecto en Producción); "No volver a preguntar en esta pestaña" dura hasta cerrar la pestaña. En conexiones de solo lectura las escrituras se bloquean en el cliente con un aviso.
- **El aviso de cambio externo no se oculta solo** (pide una decisión); un Ctrl+S explícito lo vuelve a mostrar si se cerró.
- **El foco no se roba**: al cambiar de pestaña el editor toma el foco solo si estaba en el grupo de editor; Ctrl+N y abrir desde Archivos lo enfocan explícitamente. Ocultar o maximizar los resultados no vuelve a crear el editor.
- **Acordes dentro de Monaco**: con el foco en el editor, Monaco resuelve los acordes (los suyos, como Ctrl+K Ctrl+0, y los de la app, que también se registran en Monaco). Ctrl+K Ctrl+U / Ctrl+K Ctrl+L = mayúsculas / minúsculas (`05`).
- **Alt+F4** lo resuelve Windows enviando `close` a la ventana; la prueba e2e simula ese evento.
- En Chromium reciente `scrollIntoView` devuelve una promesa: los efectos de React que lo llaman usan llaves (un efecto solo puede devolver su función de limpieza).

### Pendientes / avisos
- **Explicar plan** (Ctrl+Alt+E): hito M8 (ver más abajo); hasta entonces el botón muestra "todavía no disponible".
- **Comparar** (diff) en el aviso de cambio externo y **renombrar con F2** la pestaña: M5, junto con el watcher y las operaciones de archivos (por ahora Sobrescribir / Recargar).
- Formateo SQL (Shift+Alt+F), autocompletado, hover y F12: M6. Modo de transacción manual, Copiar como, Exportar a archivo, formato por columna y filtrar por valor: M7.
- La pestaña de objeto sigue con datos de ejemplo (M7); por eso se conserva la grilla de maqueta `ResultsGrid.tsx`.
- El chunk de Monaco pesa ~7,8 MB sin minificar; se revisará al medir el arranque (M9).

### Checklist manual de atajos (`05`)
Marcados ✅ los verificados por pruebas automáticas; el resto conviene probarlos a mano con `npm run dev`.

| Atajo | Acción | Estado |
|---|---|---|
| Ctrl+Enter | Ejecutar la sentencia bajo el cursor o la selección | ✅ e2e |
| Alt+X, F5 | Ejecutar el script (o la selección como script) | ✅ e2e (Alt+X) · F5 a mano |
| Ctrl+Alt+Shift+Enter | Ejecutar en nueva pestaña de resultado | a mano |
| Ctrl+Shift+Q, Alt+Pausa | Cancelar | ✅ e2e (Ctrl+Shift+Q) · Alt+Pausa a mano |
| Ctrl+Alt+Enter | Insertar línea debajo | ✅ e2e |
| Ctrl+K Ctrl+U / Ctrl+K Ctrl+L | Mayúsculas / minúsculas | ✅ e2e |
| Ctrl+/ | Alternar comentario | ✅ e2e |
| Ctrl+D, Ctrl+Shift+L, Alt+↑/↓, Shift+Alt+↑/↓, Ctrl+Shift+K, Ctrl+F/H, Ctrl+G, Ctrl+Espacio, Ctrl+K Ctrl+0 / Ctrl+K Ctrl+J | Propios de Monaco | a mano |
| Ctrl+S / Ctrl+K S | Guardar / Guardar todo | a mano |
| Ctrl+N | Nuevo script (conexión del árbol o de la pestaña) | ✅ e2e |
| Ctrl+W, Ctrl+Shift+T | Cerrar / reabrir pestaña | ✅ e2e |
| Ctrl+Tab, Ctrl+PgDn/PgUp, Alt+1…9 | Cambiar de pestaña | ✅ e2e (Alt+1) · resto a mano |
| Ctrl+9 / Ctrl+0 | Cambiar conexión / base-esquema | ✅ e2e |
| Ctrl+Shift+P, F1, Ctrl+P | Paletas (incluye acciones de Monaco) | ✅ e2e (Ctrl+Shift+P, Ctrl+P) · F1 a mano |
| Ctrl+C / Ctrl+Shift+C en la grilla | Copiar selección / con cabeceras | ✅ e2e |
| Ctrl+Shift+Enter en la grilla | Visor de valor | a mano |
| Ctrl+B, Ctrl+J, Ctrl+Shift+J, Ctrl+1, Ctrl+2 | Distribución y foco | ✅ e2e (Ctrl+B, Ctrl+J) · resto a mano |

## Ajustes solicitados (2026-10-01): separador de sentencias y menú contextual del editor

- **Separador de sentencias** en el menú Consulta y en el menú contextual del editor: *Línea en blanco* o *Punto y coma* (por defecto). Se guarda en `settings.json` como `sql.statementSeparator` (global, no por pestaña: es lo más simple). Con *Línea en blanco* el `;` **también** separa, para que `select 1; select 2` en una sola línea siga funcionando. Afecta a la sentencia activa, a Ctrl+Enter y a la ejecución de scripts. Actualizado en `04` §4 y §8 y en `05`.
- **Menú contextual del editor propio** en lugar del de Monaco: el de Monaco no admite submenús ni marcas ✓ y en tema claro se confundía con el fondo. El nuevo usa el componente de menú de la app (borde `border.menu` y sombra) con las mismas opciones que tenía, más el submenú del separador. Al cerrar un menú contextual, el foco vuelve a donde estaba (en el editor, al área de texto).
- **Cursor desplazado al escribir** (corregido): Monaco medía los caracteres antes de que cargara Cascadia Code; ahora se espera la fuente y se vuelve a medir si carga tarde.
- **Vistas Texto y Registro eliminadas** a pedido del usuario: los resultados se muestran siempre en la grilla. Se quitó el selector Grilla / Texto / Registro de la barra de resultados y de `04` §10.

## Ajustes solicitados (2026-10-01): plan de ejecución

- El usuario pidió la **versión completa** de *Explicar plan*. Se especifica en la nueva `12-plan-de-ejecucion.md` y se agrega al alcance (`01`).
- Nuevo hito **M8 — Plan de ejecución**, después de M7 (usa los cuatro motores y el `SAVEPOINT` del modo manual) y antes del empaquetado, que pasa a ser **M9**. Se actualizaron las referencias a M8 en specs, NOTAS y comentarios del código.
- Decisiones de la spec: comando nuevo *Explicar y ejecutar* (Ctrl+Alt+Shift+E) que revierte siempre las escrituras; en SQLite solo hay plan estimado; MySQL usa el formato `TREE` (su `EXPLAIN ANALYZE` no da JSON) y MariaDB el JSON; umbrales de avisos fijos, sin configuración; el diagrama gráfico queda fuera de v1.

## M4 — Resto de motores (2026-10-01)

### Criterios de aceptación

| Criterio | Estado |
|---|---|
| Suite de integración común en PostgreSQL | ✅ `common-suite.test.ts` (clúster temporal local) |
| Suite de integración común en SQLite | ✅ archivo temporal |
| Suite de integración común en SQL Server | ✅ SQL Server 2019 de pruebas del usuario; solo escribe en la base `dbx_test`, creada para las pruebas |
| Suite de integración común en MariaDB/MySQL | ✅ MariaDB 13.0 local del usuario (base `dbx_test`, creada por las pruebas). El RDS de desarrollo (solo lectura) no responde desde este equipo; la suite admite servidores de solo lectura con `MARIADB_READONLY=1` |
| Mismo flujo de M3 en cada motor | ✅ e2e `engines.spec.ts` en SQLite, SQL Server y MariaDB (conectar, script con varios resultados, error con su línea, cancelar) |
| Pruebas | ✅ 129 unitarias, 63 de integración (+3 que no aplican: mensajes en SQLite, varios resultados en PostgreSQL y SQLite), 51 e2e; lint y tipos limpios |

### Decisiones
- **SQLite con `node:sqlite`** (incluido en Electron 44 / Node 24) en lugar de `better-sqlite3` (cambio de D14, **confirmado por el usuario** el 2026-10-01): no hay módulo nativo que recompilar para Electron y para Node (pruebas), y `stmt.columns()` da la tabla de origen de cada columna. La API es la misma en lo que se usa (`prepare`, `iterate`, enteros grandes). Si se prefiere `better-sqlite3`, el cambio queda acotado a `drivers/sqlite`.
- **SQL Server con `tedious` directo** (D13 dice `mssql (tedious)`): hacen falta conexiones dedicadas por pestaña, pausar la lectura (`request.pause()`) y reemplazar el lector de valores; `mssql` agrega un pool que aquí estorba. Sigue siendo JavaScript puro.
- **Valores exactos en SQL Server** (`exact-values.ts`): `tedious` convierte `decimal`/`money` a `Number` y las fechas a `Date`; se envuelve `valueParser.readValue` en tiempo de ejecución para leer esos tipos como texto exacto (sin parches en `node_modules`). `datetimeoffset` conserva su desplazamiento.
- **Tabla de origen en SQL Server** con `sys.dm_exec_describe_first_result_set` en la conexión de metadatos (solo el primer resultado de cada sentencia; con tablas `#temp` no hay datos y la grilla funciona igual).
- **Varios resultados por sentencia** (bloques y `EXEC` en SQL Server, `CALL` en MariaDB): cada conjunto es una pestaña de resultado; "Cargar más" aplica al último. Si un conjunto intermedio llega al límite, los siguientes solo se leen al pedir "Cargar más".
- **Separador de sentencias**: `GO` (SQL Server, `GO n` se acepta sin repetir el lote), `DELIMITER` (MariaDB, también pegado a una palabra: `END$$`), bloques `BEGIN … END` (con `IF`/`CASE`/`LOOP`/`WHILE`/`REPEAT` en MariaDB, `TRY`/`CATCH` en SQL Server, cuerpos de `CREATE TRIGGER` en SQLite) y cuerpos de `CREATE PROCEDURE/FUNCTION/TRIGGER/VIEW` de SQL Server hasta el `GO`.
- **Esquema por sesión solo en PostgreSQL**: en SQL Server el esquema por defecto es del usuario (no se puede cambiar por sesión) y en MariaDB base = esquema; el chip de esquema y la parte de esquemas de Ctrl+0 solo aparecen en PostgreSQL.
- **MariaDB, detalles**: el envoltorio que `mysql2` pasa a `typeCast` no dice si la columna es binaria; se toma de las definiciones del evento `fields`. Al llegar al límite se pausa el socket y las filas del bloque ya recibido esperan en memoria hasta "Cargar más". `KILL QUERY` sobre `SLEEP()` no da error (devuelve 1): si el usuario canceló, la sentencia se informa como cancelada igual. En las pruebas, `seq_1_to_N` en lugar de un CTE recursivo: MariaDB corta en silencio la recursión en 1000 iteraciones (`max_recursive_iterations`).
- **Binarios** de MariaDB, SQLite y SQL Server como `0x…` (formato de literal de esos motores); la grilla formatea `\x…` y `0x…`.
- **Pruebas contra servidores compartidos**: credenciales solo en `test/integration/.env` (ignorado por git). `MARIADB_READONLY=1` marca el servidor como de solo lectura y la suite salta las pruebas que escriben; en SQL Server solo se escribe en la base de pruebas.

### Limitaciones conocidas
- **Cancelar en SQLite**: termina el hilo de la sesión al instante (la pestaña queda libre y se pierde una transacción abierta), pero si SQLite está dentro de un paso nativo largo (p. ej. un `count(*)` sobre millones de filas) ese hilo sigue hasta terminar el paso. `node:sqlite` (y `better-sqlite3`) no tienen `interrupt()` y matar un proceso aparte requiere `RunAsNode`, que `08` deshabilita.
- MariaDB: los avisos de un `SELECT` (p. ej. división por cero) no se muestran; sí los de sentencias con respuesta OK (`DO`, DML).
- SQLite: no se muestran las bases adjuntas (`ATTACH`).

### Pendientes / avisos
- MySQL (no MariaDB) no se ha probado: el driver distingue ambos (secuencias, tiempo límite), pero solo hay un servidor MariaDB disponible.
- Ancho de columnas de la grilla: es fijo por tipo (M3) y un decimal largo con separadores queda recortado a la izquierda sin `…`; conviene calcularlo por el contenido de las primeras filas.

## Ajuste solicitado (2026-10-01): selectores de la barra del editor

- Los chips de conexión, base y esquema abrían su lista arriba al centro (como la paleta), lejos del chip, y parecía que no hacían nada. Ahora la lista se despliega justo debajo del chip, como un combo, y se puede filtrar escribiendo. Con Ctrl+9 / Ctrl+0 sigue saliendo arriba al centro. Actualizado en `04` §8.
- **Guardado en Windows** (corregido): el reemplazo atómico del archivo (`rename` del temporal) fallaba con `EPERM` si otro proceso tenía el script abierto en ese instante (antivirus, indexador, OneDrive; en las pruebas, la propia lectura del archivo). Ahora se reintenta durante ~1,5 s ante `EPERM`/`EACCES`/`EBUSY`, como hace VS Code. Era la causa de la prueba e2e intermitente del cambio externo.
- **Paleta y listas invisibles en `npm run dev`** (corregido): la paleta rápida devolvía el foco al desmontarse; en desarrollo, `StrictMode` desmonta y vuelve a montar los componentes, el campo perdía el foco y la lista se cerraba en el mismo instante (no pasaba en la app compilada, por eso las pruebas no lo veían). Ahora el foco se devuelve al cerrar (Esc o clic fuera). Verificado con el renderer servido por Vite en modo desarrollo: paleta, selectores, menús de la barra de título, menú contextual y desplegables.

## Ajuste visual (2026-10-01): estado de conexión en el punto de color

- El cambio de opacidad del ícono del motor al conectar pasaba desapercibido. Ahora el punto de color de la conexión está **hueco** (solo el borde, con el color de la conexión) mientras está desconectada y **relleno** al conectarse, en el árbol, en el selector de conexión de la barra del editor y en su lista. Actualizado en `04` §5 y §8.
