# 09 — Plan de implementación (para Claude Code)

Construir por hitos. Cada hito termina con la app **arrancando y usable**, tests en verde y los criterios de aceptación verificados. Al cerrar un hito: actualizar `specs/NOTAS.md` (decisiones tomadas, desvíos, pendientes) y detenerse para revisión.

---

## M0 — Esqueleto
- `electron-vite` + React + TS estricto, ESLint, Prettier, Vitest, Playwright.
- Procesos main / preload / renderer / **db-host (utilityProcess)** comunicándose con un `ping` tipado.
- Seguridad base de `08` (contextIsolation, sandbox, CSP, bloqueo de navegación).
- Scripts npm: `dev`, `build`, `test`, `test:integration`, `test:e2e`, `lint`, `package`.
- `test/integration/docker-compose.yml` con Postgres, MariaDB y SQL Server.

**Aceptación**: `npm run dev` abre una ventana; el renderer muestra la respuesta de `ping` al db-host; `npm test` y `npm run lint` pasan.

## M1 — Shell visual
- Tokens de tema oscuro/claro (`04` §2), tipografías, Codicons.
- Title bar propia con menús y controles de ventana; activity bar; side bar; grupo de editor con pestañas; panel de resultados; status bar. Todo redimensionable y persistido en `session.json`.
- Componentes base estilo VS Code: botón, input, select, checkbox, menú contextual, dropdown, modal, toast, árbol virtualizado, pestañas.
- Paleta de comandos (Ctrl+Shift+P) con registro central de comandos `db.*` y sistema de keybindings (sin `keybindings.json` aún).
- Estados vacíos de `04` §16.

**Aceptación**: la app se ve como la maqueta (pantalla 1 y 2, con datos falsos); Ctrl+B, Ctrl+J, cambio de tema y paleta funcionan; tamaños de paneles se recuerdan al reiniciar.

## M2 — Conexiones + PostgreSQL + árbol
- `connections.json`, `secrets.bin` con safeStorage, diálogo de conexión completo (`04` §12), probar conexión.
- Interfaz `DbDriver` y driver **PostgreSQL**.
- Árbol de objetos con carga perezosa, filtro, menús contextuales, carpetas de conexiones, arrastrar para reordenar.
- Entornos y colores (D10) visibles en árbol.

**Aceptación**: crear, editar, duplicar y borrar conexiones; conectar a Postgres del docker-compose; navegar bases → esquemas → tablas → columnas; la contraseña no aparece en ningún archivo en texto plano (test automatizado que busca la contraseña en `userData`).

## M3 — Editor + ejecución + grilla
- Monaco integrado según `05` (workers locales, temas, un modelo por pestaña, viewState).
- Selectores de conexión/base/esquema en la barra del editor; sesión por pestaña.
- Splitter para Postgres (con tests), sentencia activa decorada.
- Ejecutar sentencia / script / selección, cancelar, múltiples result sets, pestaña Mensajes, errores posicionados en el editor.
- Grilla Glide con streaming por lotes, límite y "cargar más", orden y filtro rápido, selección, copiar, visor de valor.
- Formatos globales básicos (`06`).
- Confirmaciones de Producción y `UPDATE/DELETE` sin `WHERE`.
- Status bar con conexión, posición del cursor, modo de transacción.

**Aceptación**: escribir y ejecutar consultas contra Postgres con todos los atajos de `05` funcionando (checklist manual incluido en `NOTAS.md`); `SELECT` de 200 000 filas no congela la UI; cancelar `SELECT pg_sleep(30)` funciona; `numeric` y `timestamp` se muestran sin pérdida ni cambio de zona.

## M4 — Resto de motores
- Drivers **MariaDB**, **SQLite** y **SQL Server** + splitters (incluyendo `DELIMITER` y `GO`).
- Suite de integración común corriendo contra los 4 (`03` §Tests).
- Adaptar árbol a `capabilities` (sin nivel esquema en MariaDB, etc.).

**Aceptación**: la suite de integración pasa en los 4 motores; mismo flujo de M3 probado en cada uno.

## M5 — Explorador de archivos
- Todo `07`: abrir carpeta, árbol con watcher, operaciones, papelera, guardar/guardar como, hot exit de scripts, asociación archivo ↔ conexión.

**Aceptación**: crear, renombrar, mover y eliminar (a la papelera) desde el árbol; cambios externos se reflejan; cerrar y abrir la app restaura pestañas, incluso scripts no guardados.

## M6 — Productividad del editor
- Autocompletado contextual con alias, hover, F12, snippets (`05`).
- Formateo con `sql-formatter` por dialecto.
- Ctrl+P con objetos de BD y archivos; Ctrl+9 / Ctrl+0.
- `keybindings.json` y `settings.json` editables en Monaco con esquema JSON (autocompletado de claves).
- Historial de consultas.

**Aceptación**: en `SELECT c. FROM clientes c` sugiere columnas de `clientes`; nombres con mayúsculas en Postgres se insertan entrecomillados; reasignar Ctrl+Enter en `keybindings.json` surte efecto sin reiniciar.

## M7 — Pestaña de objeto, edición y exportación
- Pestaña de objeto: Datos (WHERE/ORDER BY), Estructura, DDL.
- Edición en grilla con cambios pendientes, vista previa SQL, guardado transaccional (`06`).
- Formato por columna desde la grilla con "recordar".
- Exportar CSV/JSON/XLSX/INSERT con streaming; copiar como.
- Modo de transacción manual con Commit/Rollback.

**Aceptación**: editar, insertar y eliminar filas en una tabla con PK en los 4 motores; tabla sin PK queda de solo lectura con explicación; exportar 500 000 filas a CSV sin exceder ~500 MB de memoria.

## M8 — Pulido y empaquetado
- Preferencias con UI (`04` §15) incluyendo Formatos de datos con vista previa.
- Fuses de Electron, iconos, nombre final (D1), `electron-builder` NSIS + portable, `better-sqlite3` recompilado.
- Revisión de accesibilidad básica (foco visible, navegación por teclado en todos los paneles, contraste).
- Medir arranque en frío y memoria en reposo; documentar resultados.

**Aceptación**: instalador funciona en un Windows limpio sin Node instalado; arranque < 2 s; checklist e2e (Playwright) de flujo completo pasa sobre el build empaquetado.

---

## Convenciones
- Commits pequeños por funcionalidad, mensaje en español en imperativo ("Agrega driver de MariaDB").
- Nada de secretos en tests: usar variables de `test/integration/.env.example`.
- Todo texto de UI en español, centralizado en `src/renderer/i18n/es.ts` (preparado para otro idioma sin implementarlo).
- Componentes de UI sin librerías de componentes de terceros (MUI, Ant, etc.): el look VS Code se construye con los tokens propios.
