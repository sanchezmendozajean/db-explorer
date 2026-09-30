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
- `npm run package` tiene una configuración mínima de `electron-builder` (NSIS + portable); no se ha ejecutado. Fuses, iconos y nombre final se hacen en M8.
- El bundle del renderer pesa ~645 kB sin minificar por dividir; se revisará al medir arranque en M8.

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
- El bundle del renderer pesa ~1,1 MB sin dividir; se revisará en M8.

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
- La barra de estado, las pestañas y el editor siguen con datos de ejemplo (conexión "PayBox Prod" falsa) hasta M3, cuando las pestañas se asocien a conexiones reales.
- Ctrl+P sigue buscando en objetos de ejemplo; la búsqueda real en la caché de metadatos llega en M6.

## Ajuste visual (2026-09-30): color de entorno en la pestaña

- A pedido del usuario, la línea de color de entorno de la pestaña del editor pasa del borde izquierdo al **borde superior** (2 px). En la pestaña activa con conexión reemplaza al borde de foco de 1 px; sin conexión se mantiene el borde de foco. Actualizado en `specs/04` (§ colores de entorno y § 8).
