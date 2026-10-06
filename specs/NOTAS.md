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
- ~~MySQL (no MariaDB) no se ha probado: el driver distingue ambos (secuencias, tiempo límite), pero solo hay un servidor MariaDB disponible.~~ Resuelto el 2026-10-06 (ver §MySQL).

## Ajuste solicitado (2026-10-01): selectores de la barra del editor

- Los chips de conexión, base y esquema abrían su lista arriba al centro (como la paleta), lejos del chip, y parecía que no hacían nada. Ahora la lista se despliega justo debajo del chip, como un combo, y se puede filtrar escribiendo. Con Ctrl+9 / Ctrl+0 sigue saliendo arriba al centro. Actualizado en `04` §8.
- **Guardado en Windows** (corregido): el reemplazo atómico del archivo (`rename` del temporal) fallaba con `EPERM` si otro proceso tenía el script abierto en ese instante (antivirus, indexador, OneDrive; en las pruebas, la propia lectura del archivo). Ahora se reintenta durante ~1,5 s ante `EPERM`/`EACCES`/`EBUSY`, como hace VS Code. Era la causa de la prueba e2e intermitente del cambio externo.
- **Paleta y listas invisibles en `npm run dev`** (corregido): la paleta rápida devolvía el foco al desmontarse; en desarrollo, `StrictMode` desmonta y vuelve a montar los componentes, el campo perdía el foco y la lista se cerraba en el mismo instante (no pasaba en la app compilada, por eso las pruebas no lo veían). Ahora el foco se devuelve al cerrar (Esc o clic fuera). Verificado con el renderer servido por Vite en modo desarrollo: paleta, selectores, menús de la barra de título, menú contextual y desplegables.

## Ajuste visual (2026-10-01): estado de conexión en el punto de color

- El cambio de opacidad del ícono del motor al conectar pasaba desapercibido. Ahora el punto de color de la conexión está **hueco** (solo el borde, con el color de la conexión) mientras está desconectada y **relleno** al conectarse, en el árbol, en el selector de conexión de la barra del editor y en su lista. Actualizado en `04` §5 y §8.

## Ajuste (2026-10-01): ancho de columnas según el contenido

- El ancho inicial de cada columna de la grilla era fijo por tipo y un decimal largo con separadores quedaba recortado. Ahora se mide (canvas, misma fuente que la grilla) la cabecera y el texto ya formateado de las primeras 100 filas, entre 60 y 400 px. Se calcula al llegar el primer lote y no cambia con los siguientes, para que la columna no salte mientras se cargan filas; un ancho ajustado a mano sigue teniendo prioridad.

## M5 — Explorador de archivos (2026-10-01)

### Criterios de aceptación

| Criterio | Estado |
|---|---|
| Crear, renombrar, mover y eliminar (a la papelera) desde el árbol | ✅ e2e `files.spec.ts` (campo en línea, F2, arrastrar con confirmación, Supr) |
| Los cambios externos se reflejan | ✅ e2e (archivo creado y borrado por fuera; archivo abierto recargado) |
| Cambiar el espacio de trabajo y reiniciar abre el nuevo con sus pestañas | ✅ e2e (incluye `workspace.path` en settings.json y título de la ventana) |
| Criterios de `11` §6 | ✅ Ctrl+N aparece en Archivos; guardado automático (5 s, al ejecutar, Alt+F4); restaurar pestañas; nuevos scripts en el espacio nuevo; cambio externo no se pisa; script vacío se elimina al cerrar |
| Pruebas | ✅ 146 unitarias, 64 e2e; lint, tipos y Prettier limpios |

### Decisiones
- **Árbol perezoso** por carpeta (`fs:list-dir`); Ctrl+P lee el árbol completo (hasta 5000 entradas) al abrirse.
- **Exclusiones**: `files.exclude` (`.git`, `node_modules`, `.DS_Store`, `Thumbs.db`) más los temporales `*.tmp` del guardado atómico. Antes se ocultaban todos los archivos que empiezan con punto; ahora `.env` y similares se ven.
- **Seguridad**: toda operación del árbol se valida en main con la ruta escrita y la real (`realpath`) dentro del espacio. Un archivo de fuera solo se puede leer y guardar si el usuario lo eligió en un diálogo (Abrir archivo, Guardar como); sigue permitido al restaurar sus pestañas.
- **Renombrar o mover un archivo abierto** conserva la pestaña (sesión, resultados y cambios sin guardar); solo cambian ruta y título. La asociación archivo ↔ conexión se mueve con él.
- **Papelera**: `shell.trashItem`. En pruebas (perfil aislado con `DBX_USER_DATA_DIR`) es una carpeta `Papelera` del perfil, para no tocar la Papelera de Windows.
- **Pestaña provisional**: clic simple en el árbol (cursiva), la reemplaza la siguiente; editar, doble clic o Enter la fija.
- **Archivos de texto** (`.txt`, `.json`, `.md`, `.csv`, `.log`, `.xml`, `.yml`) en el editor sin barra de ejecución ni resultados; los demás con la aplicación del sistema. JSON se resalta con la gramática de JavaScript (el servicio de JSON de Monaco necesita otro worker pesado).
- **Espacios recientes** en `userData/workspaces/recientes.json` (máx. 10). El predeterminado se guarda como "sin valor" en `workspace.path`, para que siga a la carpeta Documentos.
- **Espacio no disponible**: modal con Reintentar / Elegir otra carpeta / Usar el predeterminado; este último no borra `workspace.path`.
- **Comparar** en el aviso de cambio externo: editor de diferencias de Monaco (disco a la izquierda, editor a la derecha) con Sobrescribir / Recargar.
- **Fin de línea**: clic en la status bar para elegir LF o CRLF.
- **Preferencias** como pestaña del editor (`04` §15) con solo el grupo Archivos (`11` §5) más `files.confirmDragAndDrop` y `files.autoReveal`; el buscador y el resto de los grupos llegan en M9.
- **Asociación archivo ↔ conexión** (corregido): las claves de `fileConnections` se guardaban como rutas absolutas; ahora son relativas al espacio, como dice `11` §3.

### Pendientes / avisos
- Comentario `-- @connection:` en la primera línea (`07`, opcional y desactivado por defecto): no implementado.
- El árbol tiene selección simple (sin Ctrl/Shift+clic para varios archivos).
- El filtro al escribir busca solo en las carpetas ya cargadas (expandidas alguna vez).

## M6 — Productividad del editor (2026-10-02)

### Criterios de aceptación

| Criterio | Estado |
|---|---|
| En `SELECT c. FROM clientes c` sugiere columnas de `clientes` | ✅ e2e `productivity.spec.ts` y unitarias `sql-context.test.ts` |
| Nombres con mayúsculas en Postgres se insertan entrecomillados | ✅ e2e (`"CRendiciones_Conf_Generales"`) |
| Reasignar Ctrl+Enter en `keybindings.json` surte efecto sin reiniciar | ✅ e2e (Ctrl+E ejecuta y Ctrl+Enter queda libre, guardando el archivo desde fuera) |
| Hover, F12, formateo, historial, `settings.json` con autocompletado de claves | ✅ e2e |
| Pruebas | ✅ 161 unitarias, 53 de integración, 72 e2e (tres corridas seguidas); lint, tipos y Prettier limpios |

### Decisiones
- **Catálogo = caché del árbol de conexiones**: tablas y vistas por esquema, y columnas solo de las tablas que hacen falta (las de la sentencia o la del calificador). Traer todas las columnas de una vez sería muy pesado en bases de miles de tablas (SAP B1). Se precarga en segundo plano el esquema de la pestaña activa al conectar o cambiar de base/esquema. Los nodos de columna ahora traen tipo, nulo, default y comentario (`TreeNodeData.column`).
- **Contexto de autocompletado** (`shared/sql-context.ts`, puro y probado): tablas de la sentencia con alias (`FROM`, `JOIN`, `UPDATE`, `INTO`, listas con coma) e identificadores entre comillas de cada dialecto; tipo de lugar (tablas, columnas, `algo.`, general). En PostgreSQL los nombres sin esquema se buscan en el esquema elegido y luego en `public`.
- **Entrecomillado** con `quoteIdent` del motor; si se empieza a escribir con comilla (`"CRe`), se filtra con el nombre entre comillas.
- **F12 y Ctrl+P sobre un objeto** lo seleccionan en el árbol de conexiones (la pestaña de objeto llega en M7). Ctrl+P busca en los objetos ya cargados en la caché (specs/04 §13).
- **Formateo** con `sql-formatter` (dialecto según el motor, tabulación de `editor.tabSize`, mayúsculas como estén escritas) **sentencia por sentencia**: lo que hay entre sentencias (`GO`, `DELIMITER`, comentarios sueltos) queda intacto, porque `sql-formatter` rompe `DELIMITER`. Una sentencia que no se puede analizar se deja como estaba y se avisa. Es el proveedor de formato de Monaco: también funciona "Dar formato al documento/selección".
- **Historial** en `userData/history.sqlite` (con `node:sqlite` en main): main asocia cada sentencia de `query:execute` con sus eventos y guarda fecha, conexión (nombre y motor del momento), base, SQL, duración, filas y error. `history.enabled` y `history.maxEntries` (5000, se recorta cada 50 inserciones). Vista en la barra lateral: filtro por texto (sin comodines) y conexión; doble clic abre en un script nuevo, Enter inserta en el script actual, Supr quita. La pestaña Historial del panel de resultados se quitó (specs/04 la pedía solo si no estaba en la activity bar).
- **settings.json y keybindings.json** se abren en el editor (creándolos con una plantilla comentada) con esquema JSON: claves y valores de `SETTINGS_SCHEMA` (generados con `z.toJSONSchema`) y comandos de la app para `keybindings.json`. Main observa la carpeta de `userData`, así que guardar en la app o con otro editor se aplica sin reiniciar. Las entradas no válidas de `keybindings.json` se omiten con aviso. Los archivos `.json` del espacio de trabajo también usan ahora el servicio de JSON de Monaco (con su worker empaquetado).

### Pendientes / avisos
- Los acordes de dos teclas de `keybindings.json` (p. ej. `ctrl+k ctrl+e`) funcionan fuera del editor; dentro de Monaco solo se registran los acordes por defecto.
- El diálogo Ayuda › Atajos de teclado muestra los atajos por defecto, no los personalizados.
- El autocompletado no sugiere columnas de subconsultas ni de CTE (solo de tablas y vistas del catálogo).
- Una vez la preparación de `productivity.spec.ts` y otra una prueba de `connections.spec.ts` fallaron por tiempo en corridas completas; no se reprodujeron en tres corridas seguidas.

## M7 — Pestaña de objeto, edición y exportación (2026-10-02)

### Criterios de aceptación

| Criterio | Estado |
|---|---|
| Editar, insertar y eliminar filas en una tabla con PK en los 4 motores | ✅ integración (`common-suite.test.ts`: guardado con UPDATE/INSERT/DELETE, reversión ante clave inexistente y ante error del motor, y dentro de una transacción manual) en PostgreSQL, MariaDB, SQLite y SQL Server; e2e en SQLite (editar celda, Alt+Insert, Ctrl+Supr, "Ver SQL" → Aplicar) |
| Tabla sin PK de solo lectura con explicación | ✅ e2e (`data.spec.ts`: candado "Solo lectura" con el motivo en el tooltip) |
| Exportar 500 000 filas a CSV sin exceder ~500 MB | ✅ integración (`export.test.ts`): el proceso crece unos 110 MB exportando 500 000 filas de PostgreSQL (archivo de ~35 MB) |
| Modo manual con Commit/Rollback | ✅ integración en los 4 motores y e2e (contador de pendientes, Rollback con el botón y Commit con Ctrl+Alt+C) |
| Pruebas | ✅ 171 unitarias, 82 de integración (4 motores), 82 e2e; lint, tipos y Prettier limpios |

### Qué se construyó
- **Pestaña de objeto** (tablas y vistas): doble clic o Enter en el árbol, "Ver datos" / "Ver estructura", F12 y Ctrl+P. Breadcrumb real y subpestañas **Datos** (WHERE y ORDER BY con Monaco de una línea y autocompletado de columnas; Enter ejecuta), **Estructura** (columnas, índices, claves y restricciones) y **DDL** (Monaco de solo lectura y "Abrir en script"). "Nuevo script ▸ DDL" en el menú de la tabla.
- **Edición en grilla** (specs/06): editar celda (doble clic, F2, Enter o escribir), Supr vacía, Shift+Supr NULL, Alt+Insert agrega fila (las columnas sin valor quedan en `DEFAULT`), duplicar fila (sin la clave), Ctrl+Supr elimina, Ctrl+Z deshace, Ctrl+V pega TSV de Excel. Colores de pendientes (editada, nueva, eliminada), "Guardar (n)", Descartar, "Ver SQL" (sentencias con literales → Aplicar) y "n cambios pendientes" en el pie. En Producción siempre pide confirmación. Un error revierte todo y marca la fila (texto en rojo y tooltip con el mensaje).
- **Editable** si el resultado viene de una sola tabla e incluye todas las columnas de la PK (o de un índice único sin nulos); las columnas que son expresiones quedan de solo lectura. La clave sale de `meta:table` (cacheado por conexión; "Refrescar" en el árbol lo vuelve a leer). Motivos de solo lectura: conexión de solo lectura, vista, varias tablas, motor sin tabla de origen, sin clave, clave incompleta.
- **Formato por columna** (menú de celda › "Formato de columna…"): popover de 280 px con los controles del tipo, alineación, vista previa con la celda seleccionada y "Recordar para tabla.columna" (`format.columns` en settings.json, clave `conexión/base/esquema/tabla/columna`).
- **Copiar como** (CSV, TSV, JSON, Markdown, INSERT, lista IN y TSV con formato) sobre la selección; **Filtrar por este valor / Excluir este valor** (chips en la barra para quitarlos).
- **Exportar** CSV (separador, cabeceras, BOM), JSON, XLSX (números, fechas y booleanos con su tipo) y SQL INSERT: diálogo de opciones y "Guardar como" de main; avance y cancelación en una notificación; si el resultado está truncado se puede re-ejecutar sin límite y exportar en flujo. "Copiar como Markdown" copia la tabla cargada.
- **Modo de transacción** por pestaña: chip Auto/Manual, Commit/Rollback y "n sentencias pendientes" en la barra; "Manual (n)" en la status bar (clic alterna); menú Consulta. Cerrar la pestaña o la app con una transacción abierta pregunta Commit / Rollback / Cancelar; pasar a Auto con pendientes, también.
- **"Ordenar en servidor"** en la pestaña de objeto cuando el resultado está truncado y se ordenó en cliente: escribe el ORDER BY y re-ejecuta.
- Se quitaron la grilla de maqueta (`ResultsGrid.tsx`), los datos de ejemplo y el comando de desarrollo que los alternaba.

### Decisiones
- **La pestaña de objeto usa una sesión propia** (no la de metadatos, como decía specs/03): así tiene límite, "Cargar más" y cancelación como el editor, y guarda las ediciones en la misma conexión. Su modo de transacción es siempre auto-commit. Sus consultas de datos no van al historial.
- **Vista previa en el árbol**: la pestaña de objeto abierta desde el árbol es *preview* (cursiva) y se reemplaza al abrir otra; al editar datos queda fija. F12 y Ctrl+P la abren fija. Las pestañas de objeto no se restauran al reiniciar (solo los scripts, specs/11).
- **Orden de las sentencias al guardar**: eliminaciones, ediciones e inserciones (libera claves únicas antes de reutilizarlas).
- **Tras guardar**: la pestaña de objeto vuelve a leer los datos (muestra valores por defecto y claves generadas); en el panel de resultados las filas se actualizan en la grilla y las columnas que no se escribieron de una fila nueva quedan en NULL hasta re-ejecutar (re-ejecutar un script podría repetir escrituras).
- **Contador de pendientes**: cuenta las escrituras ejecutadas en modo manual (y las sentencias de un guardado de grilla); un `COMMIT`/`ROLLBACK` escrito por el usuario lo vuelve a cero.
- **Exportar re-ejecutando** usa una sesión aparte (`<pestaña>#exportar`) para no cerrar el cursor de "Cargar más" ni ocupar la pestaña; por eso no ve cambios sin confirmar de una transacción manual. Exporta las columnas visibles; las filas cargadas van en el orden y filtro de la vista, las re-ejecutadas en el orden del servidor. Los cambios pendientes de la grilla no se exportan.
- **Rutas de exportación**: el renderer solo puede exportar a una ruta elegida en el diálogo de main (`data:pick-export-path`), según specs/08. Nuevo dominio IPC `data:*` (specs/02).
- **XLSX propio** (sin dependencias): ZIP en flujo con `deflate` y descriptor de datos, hoja con texto en línea; decimales de más de 15 dígitos se dejan como texto para no perder precisión.
- **Formato de los reales que llegan como número** (SQLite): ahora se les aplica el modo de decimales y los dígitos de flotantes (antes solo separadores).
- **Literales de "Ver SQL"**: decimales y enteros sin comillas, binarios según el motor (`'\x…'::bytea`, `X'…'`, `0x…`), `N'…'` en SQL Server y barra invertida escapada en MariaDB.

### Pendientes / avisos
- El visor de valor sigue siendo de solo lectura (specs/04 lo pide editable si la celda lo es).
- SQLite no informa las restricciones CHECK por separado (se ven en el DDL).
- Cancelar en SQLite termina el hilo de la sesión y con él la transacción manual abierta; el contador de pendientes no se entera. Cambiar de base con una transacción manual abierta también la revierte (se abre otra sesión) sin preguntar.
- Pulsar Commit/Rollback mientras la pestaña ejecuta da "La pestaña ya está ejecutando una consulta".
- El editor de celda de Glide pierde teclas con la escritura instantánea de Playwright (no a velocidad humana): las pruebas llenan el editor con `fill`.
- El formato por conexión (nivel 2 de specs/06) llega con las Preferencias de M9.

## M8 — Plan de ejecución (2026-10-05)

### Criterios de aceptación

| Criterio | Estado |
|---|---|
| Ctrl+Alt+E sobre un `JOIN` muestra el árbol con costos (salvo SQLite) y el detalle de cada nodo, en los 4 motores | ✅ integración (`common-suite.test.ts`: el árbol tiene la tabla de cada lado y costo total en PostgreSQL, MariaDB y SQL Server; en SQLite, sin costos); e2e en PostgreSQL (`plan.spec.ts`: árbol, detalle al seleccionar un nodo, Esc lo cierra, Ver original con el JSON) |
| *Explicar y ejecutar* muestra filas y tiempos reales en PostgreSQL, MariaDB/MySQL y SQL Server | ✅ integración en los tres (MySQL 8 solo con fixtures, ver avisos) |
| Un `DELETE` explicado y ejecutado no borra filas | ✅ integración en PostgreSQL, MariaDB y SQL Server, en auto-commit y dentro de una transacción manual (punto de guardado; la transacción sigue abierta y un Rollback posterior revierte lo anterior) |
| Un recorrido completo de una tabla de 10 000+ filas aparece con aviso | ✅ integración (tabla de 20 000 filas) en PostgreSQL, MariaDB y SQL Server; e2e en PostgreSQL ("1 aviso" y el texto en el detalle). SQLite no entrega estimaciones: sin aviso |
| En Producción, *Explicar y ejecutar* de una escritura pide confirmación | ✅ e2e (`UPDATE`: modal de Producción con "La sentencia se ejecutará para medir el plan y luego se revertirá"; después, los datos no cambiaron) |
| Pruebas | ✅ 185 unitarias (parsers con planes reales de los 4 motores), 94 de integración (4 motores), 89 e2e; lint, tipos y Prettier limpios |

### Qué se construyó
- **db-host**: `DbSession.explain` en los cuatro drivers y un parser por formato junto a cada driver (`drivers/<motor>/plan.ts`): JSON de PostgreSQL (con `VERBOSE` y, en real, `BUFFERS`), JSON de MariaDB (`EXPLAIN`/`ANALYZE FORMAT=JSON`), árbol de texto de MySQL 8, `EXPLAIN QUERY PLAN` de SQLite y showplan XML de SQL Server (`fast-xml-parser`). `plan-builder.ts` calcula costo y tiempo propios y los avisos comunes.
- **Pestaña Plan** del panel de resultados (antes de Mensajes; "Plan (real)" si se ejecutó; se cierra con su ✕): barra con chip Estimado/Real, resumen, contador de avisos (salta al siguiente nodo con avisos), Expandir/Contraer todo, Ver original (Monaco de solo lectura; el XML de SQL Server se muestra con sangría), Copiar original y Volver a explicar. Árbol-tabla virtualizado con íconos por familia, condición en segunda línea, barras de costo y tiempo, columnas que se ocultan si no hay datos y anchos redimensionables. Panel de detalle de 300 px por grupos (General, Estimado, Real, Avisos). Teclado: flechas, Enter abre el detalle, Esc lo cierra, Ctrl+C copia la fila.
- **Comandos** *Explicar plan* (Ctrl+Alt+E) y *Explicar y ejecutar* (Ctrl+Alt+Shift+E) en el menú Consulta, el menú contextual del editor, la paleta y el botón de la barra del editor. En SQLite *Explicar y ejecutar* queda deshabilitado con el motivo en el tooltip del menú (nuevo `disabledReason` de los comandos).
- **Historial**: las entradas de plan se marcan "Plan" o "Plan (real)" (columna nueva `plan` en `history.sqlite`, agregada al abrir historiales anteriores).

### Decisiones
- **El plan viaja por `query:execute`** con el campo `explain` y el evento `plan` (specs/02), no por un canal nuevo: reutiliza cronómetro, barra de progreso, cancelación, mensajes del motor e historial.
- **Explicar y ejecutar siempre va dentro de una transacción que se revierte**, también para lecturas (más simple y sin riesgo). En modo manual usa siempre un punto de guardado; si la pestaña no tenía transacción abierta, queda una abierta y vacía (la que el modo manual abre con cada sentencia).
- **Modelo común**: las propiedades del nodo llevan su grupo del panel de detalle (`general`, `estimated`, `actual`) y el alias va aparte para mostrarlo en `fg.muted` (specs/12 §3 actualizado).
- **Recorrido completo**: se usan las filas que el motor lee, no las que devuelve tras el filtro: en PostgreSQL `reltuples` del catálogo (si la tabla nunca se analizó, las estimadas o, en real, las devueltas más las descartadas por el filtro); MariaDB y MySQL, `rows` del recorrido; SQL Server, `TableCardinality` de *Table Scan* y *Clustered Index Scan*. No cuentan las tablas temporales (`pg_temp`, `#tabla`, `<derived>`).
- **Estimación errada**: se compara por ejecución del nodo (filas reales ÷ bucles contra las estimadas), porque los motores estiman las filas de una ejecución.
- **Avisos de MariaDB/MySQL** "Using filesort" y "Using temporary" cuando alguna tabla debajo tiene 10 000 filas estimadas o más (mismo umbral del recorrido completo). Uso de disco en MariaDB: `filesort` con `r_used_priority_queue: false` y `r_sort_passes > 0`.
- **Tablas sin transacciones** (MyISAM, Aria): antes de medir una escritura en MariaDB/MySQL se comprueban las tablas del plan estimado y cualquier palabra de la sentencia que coincida con una tabla no transaccional de la base actual (o de una base nombrada en la sentencia). Puede bloquear de más, nunca de menos.
- **Sentencias de estructura**: además de `CREATE`, `ALTER` y `DROP`, también `TRUNCATE`, `RENAME`, `GRANT`, `REVOKE` y `COMMENT` (varios motores las confirman o no las pueden revertir).
- **Explicar no toca los resultados**: no descarta los result sets ni pregunta por cambios de grilla pendientes, no guarda el archivo antes (guardado automático) y "Re-ejecutar" sigue repitiendo la última consulta. "Volver a explicar" repite la última sentencia explicada de la pestaña con su modo, aunque el editor haya cambiado.
- **Detalle**: se abre con clic en un nodo o Enter; moverse con las flechas no lo vuelve a abrir si se cerró con Esc. El costo de la barra es el **propio**; el tooltip muestra también el del subárbol.
- Los fixtures de planes (`test/unit/fixtures/plans/`) se guardan tal como los devolvió cada motor y quedan fuera de Prettier.
- Se quitó el CSS de la grilla de maqueta que había quedado de M7.
- **Corregido de paso**: un `settings:changed` atrasado podía devolver por un instante un control de Preferencias a su valor anterior justo después de cambiarlo (el store ahora conserva los valores que se están guardando).
- **Pruebas e2e más estables**: la edición en grilla de `data.spec.ts` repite la edición si el editor de Glide confirmó el valor anterior (pasa con la máquina cargada, no a velocidad humana; la grilla expone `data-undo-depth`), y su `afterAll` termina el árbol de procesos en Windows: una app que quedaba viva tras un fallo cargaba la máquina y hacía fallar otras pruebas. Tres corridas completas seguidas en verde.

### Pendientes / avisos
- ~~**MySQL 8 sin servidor de pruebas**: el parser del árbol de texto se probó con fixtures escritos según el formato documentado.~~ Resuelto el 2026-10-06 con planes reales (ver §MySQL).
- Los anchos de columna de la pestaña Plan no se recuerdan entre planes; si no entran todas, las últimas quedan recortadas (sin desplazamiento horizontal).
- SQL Server: los planes con cientos de nodos se virtualizan, pero solo se probaron planes reales pequeños.

## MySQL (2026-10-06)

El 2026-10-05 MySQL quedó "por completar" por no tener servidor de pruebas. El 2026-10-06 el usuario instaló MySQL 26.7 en su equipo y se completaron las pruebas: MySQL vuelve al alcance (specs/01).

### Qué se probó
- **Suite común de integración** completa con un caso MySQL (mismo driver que MariaDB, detectado al conectar): conexión, árbol, tipos sin pérdida, límite y "Cargar más", errores con posición, cancelar, mensajes, varios resultados, DML, estructura, modo manual, guardado de ediciones, exportación y plan de ejecución.
- **Nuevas pruebas para todos los motores**: claves foráneas y CHECK en `tableDetails` (en SQLite solo la foránea), tiempo límite de consulta de la conexión (MariaDB y MySQL) y *Explicar y ejecutar* de un JOIN con filas y tiempos reales.
- **e2e por motor** (`engines.spec.ts`) con MySQL: conectar, script con varios resultados, error en su línea y cancelar.
- Los fixtures del plan de MySQL ahora son planes reales capturados del servidor (antes, escritos según la documentación).

### Corregido y decisiones
- **Plan de `UPDATE`/`DELETE` de una tabla en MySQL**: el formato de árbol (y `EXPLAIN ANALYZE`) responde `<not executable by iterator executor>`. El plan estimado se pide entonces con `EXPLAIN FORMAT=JSON` en la versión 1 del formato (con `query_block`; desde MySQL 8.3 la predeterminada puede ser la 2, que tampoco describe esas sentencias), restaurando la versión de la sesión. *Explicar y ejecutar* informa "MySQL no puede medir esta sentencia…": MySQL solo mide consultas y `UPDATE`/`DELETE` de varias tablas. El parser JSON de MariaDB interpreta también el de MySQL (`rows_examined_per_scan`, `cost_info`).
- **Literales enteros**: MySQL declara `BIGINT` los enteros de `SELECT 1`, `count(*)` o un CTE recursivo, y el driver deja los `BIGINT` como texto (sin pérdida). Se mantiene: en la grilla se ven igual (tipo lógico entero). El ancho declarado no sirve para decidir (un CTE recursivo informa ancho 2 aunque sus valores crezcan).
- **CTE recursivos**: MySQL los corta en 1000 niveles (`cte_max_recursion_depth`); las pruebas suben el límite con la pista `SET_VAR`.
- La status bar muestra "SQL (MariaDB/MySQL)" para ambos.
- `test/integration/docker-compose.yml` incluye MySQL 8.4 para equipos sin MySQL instalado.
- Corregido de paso en `engines.spec.ts`: la regex de los nombres de captura había perdido su barra invertida (`/W+/` en lugar de `/\W+/`).

### Pendientes / avisos
- MySQL de versiones anteriores a 8.0.16 no informa CHECK; anteriores a 8.0.18 no tienen `EXPLAIN ANALYZE` (no se probaron).

## M9 — Pulido y empaquetado (2026-10-06)

### Criterios de aceptación

| Criterio | Estado |
|---|---|
| El instalador funciona en un Windows limpio sin Node instalado | ✅ con una salvedad: no hay una máquina limpia, así que se instaló en silencio (`/S /D=…`, por usuario) en este equipo y se recorrió la checklist sobre el programa instalado con un PATH solo de Windows (sin Node); desinstalación sin restos (carpeta, entrada de Windows y accesos directos). El portable pasa la misma checklist |
| Arranque < 2 s | ✅ mediana de 0,66 s instalado y 0,75 s desde `dist/win-unpacked` (5 arranques, `npm run measure`), incluido el primer uso con `userData` nuevo. Excepción: la primera ejecución de un binario recién compilado tardó 3,5 s (el antivirus lo analiza y la caché de disco está vacía); no se pudo medir tras reiniciar el equipo |
| Checklist e2e de flujo completo sobre el build empaquetado | ✅ `npm run test:packaged`: 10 pasos (arranque, PostgreSQL con árbol y script, plan, pestaña de objeto, SQLite, SQL Server, MariaDB y MySQL cargados desde `app.asar`, Archivos, Preferencias, cierre que guarda y reapertura que restaura). Pasa sobre `win-unpacked`, el programa instalado y el portable |
| Pruebas | ✅ 210 unitarias, 124 de integración (5 servidores), 99 e2e y 10 sobre el empaquetado; lint, tipos y Prettier limpios |

### Mediciones (Windows 11, este equipo)
- **Arranque** hasta la interfaz pintada (marca `dbx-listo`): 0,66 s de mediana instalado (0,66–0,71 s); 0,72–0,80 s desde `win-unpacked`.
- **Memoria en reposo** (10 s tras arrancar, sin pestañas): 477–489 MB de conjunto de trabajo y 275–282 MB privados entre los 5 procesos (main, renderer, GPU, red y db-host). Casi todo es la base de Chromium/Electron.
- **Tamaños**: instalador y portable de ~116 MB (Electron es casi todo); `app.asar` de 34,5 MB. JavaScript del renderer minificado: 1,3 MB al arrancar y 4,1 MB de Monaco, que se carga al abrir el primer script.

### Qué se construyó
- **Preferencias** completas (specs/04 §15): buscador (sin tildes ni mayúsculas), índice lateral y los grupos Editor, Archivos, Resultados, Formatos de datos, Conexiones y Apariencia. Cada ajuste distinto del valor por defecto lleva una barra azul y "Restablecer". Los campos de texto y número guardan al confirmar (Enter o al salir), no en cada tecla.
- **Formatos de datos** con vista previa en vivo por tipo y "Restablecer" por fila. **Formato por conexión** (nivel 2 de specs/06): "Aplicar a" elige una conexión; sus cambios se guardan en `format.connections` y la grilla los aplica entre el global y el de la columna (también el popover de formato de columna y "TSV con formato").
- **Accesibilidad**: contraste AA de los tokens verificado con una prueba; F6 / Shift+F6 recorren las partes del workbench; foco visible en un árbol sin selección y en Mensajes.
- **Empaquetado**: ícono propio (`resources/icon.svg` → `.ico` y `.png` con `npm run icon`), fuses, instalador NSIS por usuario con carpeta elegible y accesos directos, y versión portable.

### Decisiones
- **Nombre (D1)**: se mantiene "DB Explorer"; el usuario no eligió otro. Cambiarlo es tocar `productName`/`appId` en `electron-builder.yml` y los textos de `es.ts`.
- **Fuses** (specs/08): RunAsNode, NODE_OPTIONS e inspector de Node desactivados; cifrado de cookies y carga solo desde `app.asar` activados. `GrantFileProtocolExtraPrivileges` queda como viene (el renderer y los workers de Monaco se cargan desde `file://`). No se activó la validación de integridad del asar (no la pide la spec).
- **Dependencias**: solo las de main y del db-host quedan en `dependencies` (pg, pg-cursor, mysql2, tedious, zod, jsonc-parser, fast-xml-parser); las del renderer pasan a `devDependencies` porque Vite ya las empaqueta. Se excluyen del asar la variante de navegador de MSAL (que trae tedious para Azure AD), los mapas de código y los `.d.ts`.
- **Electron del proyecto** (`electronDist: node_modules/electron/dist`): el empaquetado no descarga Electron ni lo extrae (la extracción fallaba con EPERM).
- **Antivirus**: el Kaspersky del equipo bloquea que electron-builder lance PowerShell (para listar dependencias) cuando corre dentro de `npm run`; `scripts/electron-builder.mjs` lo lanza como proceso directo de Node y así no se bloquea.
- **Pruebas sobre el empaquetado por CDP** (`--remote-debugging-port`): el lanzador de Electron de Playwright necesita el inspector de Node, que el fuse desactiva. Sin acceso al proceso main, la checklist verifica todo desde la interfaz y los archivos de `userData`.
- **`DBX_USER_DATA_DIR`** también funciona en el build empaquetado (antes solo en desarrollo), para aislar las pruebas de los datos reales. No agrega riesgo: quien fija el entorno del proceso ya puede ejecutar código con los permisos del usuario.
- **Medición**: marca `performance.mark('dbx-listo')` en el renderer tras el primer cuadro pintado; `scripts/measure-startup.mjs` mide desde el lanzamiento del proceso hasta esa marca.
- **Contraste**: se ajustaron lo mínimo `fg-muted`, `fg-null`, `error` (ambos temas), `warning` (claro, se usa como texto en los avisos del plan) y `border-focus` (oscuro). Excepción: los bordes de los campos conservan el aspecto de VS Code (contraste menor a 3:1); el campo se reconoce por su fondo, su etiqueta y el borde azul al enfocarlo.
- **Conexiones** en Preferencias no tiene ajustes propios (specs/04 no los define): explica que cada conexión se configura en su diálogo y que su formato propio está en Formatos de datos, con un botón "Nueva conexión".
- **Editor** en Preferencias edita `editor.fontSize`, `editor.tabSize`, `editor.wordWrap` y `editor.lineNumbers`; el resto de las opciones de Monaco sigue en settings.json.

### Corregido de paso
- **Origen del renderer con "~" en la ruta**: Chromium deja el "~" en la URL del archivo y Node lo codifica como `%7E`; instalado en una ruta con "~" (como un nombre corto 8.3 de Windows) todo el IPC se rechazaba con "Origen no autorizado". Ahora se comparan rutas.
- **Checkbox**: su input oculto no tenía contenedor posicionado y podía quedar debajo de otro elemento, que recibía el clic. Probablemente explica la intermitencia del checkbox de Preferencias vista en M8.

### Pendientes / avisos
- Los ejecutables no están firmados: SmartScreen puede advertir al abrirlos la primera vez.
- No se probó en una máquina Windows limpia ni el arranque en frío tras reiniciar.
- El JSON de `format.json: pretty` no cambia la celda (siempre en una línea); por eso no está en Preferencias.

## Ajustes tras M9

- **Filtro del explorador** (pedido del usuario): filtraba cualquier nodo, incluidas conexiones y columnas, y con un texto sin coincidencias ocultaba todas las conexiones. Ahora solo compara el nombre de los objetos (tablas, vistas, funciones, procedimientos, secuencias…). Carpetas y conexiones siempre quedan; bases, esquemas y carpetas de objetos, si contienen coincidencias o aún no se cargaron (para poder expandirlos). Un objeto que coincide conserva sus columnas e índices. Actualizado en `04` §Filtro.
