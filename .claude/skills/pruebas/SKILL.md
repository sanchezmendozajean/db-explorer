---
name: pruebas
description: Cómo correr y escribir las pruebas de DB Explorer (unitarias, integración en los cuatro motores, e2e con Playwright sobre Electron), qué servidores de prueba se pueden usar y con qué restricciones, y cómo evitar las intermitencias conocidas. Usar antes de correr o escribir pruebas o al investigar un fallo intermitente.
---

# Pruebas

## Comandos
| Qué | Comando | Notas |
|---|---|---|
| Unitarias | `npx vitest run` | `test/unit`, sin servidores. |
| Integración | `npx vitest run --config vitest.integration.config.ts` | `globalSetup` levanta un PostgreSQL local temporal; MariaDB, MySQL y SQL Server según `test/integration/.env`. Un motor sin servidor se salta con el motivo. |
| e2e | `npm run test:e2e` (build + Playwright) o, con el build ya hecho, `npx playwright test [archivo]` | Lanza el build de `out/` con un `userData` temporal. **Rehacer el build** (`npx electron-vite build`) después de cambiar código: Playwright no recompila. |
| Lint y tipos | `npm run lint` | ESLint + los cuatro `tsc`. |
| Formato | `npx prettier --check src test` | `test/unit/fixtures/` está excluido a propósito. |

Una corrida e2e completa sana tarda ~1,2 min con un solo worker.

## Servidores de prueba y restricciones (autorizados por el usuario)
Credenciales solo en `test/integration/.env` (ignorado; plantilla en `.env.example`). Nunca escribirlas en commits, skills ni logs.
- **PostgreSQL**: clúster temporal local creado por `test/integration/pg-server.ts` (o Docker). Libre.
- **MariaDB local** (instalada por el usuario en su equipo, servicio `MariaDB`, usuario root): se puede escribir **solo en la base `dbx_test`**.
- **MySQL local** (instalado por el usuario en su equipo, puerto 3307, usuario root): se puede escribir **solo en la base `dbx_test`**. Variables `MYSQL_*` en `.env`; sin servidor, `docker compose` levanta MySQL 8.4 en el 53307.
- **MariaDB/MySQL de desarrollo en RDS**: **solo lectura**. Prohibido `UPDATE`, `DELETE`, `CREATE` o cualquier sentencia que cambie datos o estructura; si hiciera falta, pedírselo al usuario. Con `MARIADB_READONLY=1` la suite salta las pruebas que escriben. Normalmente no responde desde el equipo de desarrollo y queda comentado en `.env`.
- **SQL Server** de la empresa (2019 Developer): escribir **solo en la base `dbx_test`**, creada para las pruebas (con `ALLOW_SNAPSHOT_ISOLATION` activado para leer desde otra sesión sin bloquearse). Nunca tocar las bases existentes (son de SAP Business One).
- Antes de cualquier escritura en un servidor remoto, verificar el destino.
- Si un servidor no es alcanzable desde un equipo, la suite lo salta: no es un fallo.

## Integración (`test/integration`)
- `engines.ts` define un `EngineCase` por motor (conexión, si se puede escribir, `prepare`, SQL propio del dialecto y tablas del plan). `common-suite.test.ts` corre las mismas pruebas en los cuatro.
- Calificar nombres según el motor: SQL Server no fija el esquema por sesión (el predeterminado es del usuario, `dbo`), así que se usa `comun.tabla`; en PostgreSQL la sesión fija `search_path`; en MariaDB la base de la sesión.
- MariaDB corta en silencio un CTE recursivo a las 1000 iteraciones (`max_recursive_iterations`): para generar filas usar el motor de secuencias (`seq_1_to_N`).
- mysql2 solo informa la cantidad de avisos en respuestas OK (no en SELECT): para probar avisos usar `DO 1 / 0`.

## Fixtures de planes de ejecución
- `test/unit/fixtures/plans/` guarda planes **reales** tal como los devolvió cada motor (no formatear). Para capturar nuevos: una prueba temporal de integración que ejecute el `EXPLAIN` del motor con `manager.execute` y escriba la primera celda a un archivo; borrarla después (no se commitea).
- SQL Server: `SET SHOWPLAN_XML ON` / `SET STATISTICS XML ON` deben ir en su propio lote (sentencias separadas).
- Los fixtures de MySQL (`mysql-*`) son planes reales de MySQL 26.7.

## e2e (Playwright + Electron): intermitencias conocidas
- **Apps de prueba que quedan vivas**: si varias pruebas que antes pasaban empiezan a fallar y la corrida tarda más (~1,7 min), buscar `electron.exe` sueltos de corridas anteriores (PowerShell: `Get-CimInstance Win32_Process -Filter "Name='electron.exe'"`) y terminarlos con `taskkill /PID <pid> /T /F`. En Windows `app.process().kill()` no siempre cierra la app (por ejemplo, si pregunta por cambios sin guardar). Un `afterAll` que pueda dejar la app con cambios debe terminar el árbol con `taskkill /T` (ver `data.spec.ts`).
- **Editor de celda de Glide**: es controlado y pierde teclas simuladas; se llena con `input.fill(...)`. Además guarda el texto en un cuadro posterior, y con la máquina cargada Enter a veces confirma el valor anterior. `editCell` en `data.spec.ts` reintenta comparando `data-undo-depth` de la grilla (cada edición registrada agrega un paso de deshacer). Abrir el editor con doble clic.
- **Grilla en canvas**: las celdas no son DOM. Las pruebas calculan coordenadas con `data-column-widths` (cabecera 26 px, filas 24 px, números de fila 48 px) y leen datos copiando la tabla al portapapeles (`clipboard.readText()` vía `app.evaluate`).
- **Esperar fin de ejecución**: `execution-timer` con cuenta 0. Antes de un atajo que dependa del resultado (p. ej. Ctrl+Alt+C), esperar el indicador correspondiente (`tx-pending`).
- `react-resizable-panels` pone `data-testid` igual al `id` del `Panel`: no reutilizar como id un valor que ya se usa como `data-testid`.
- Diálogo "Guardar como": se reemplaza `dialog.showSaveDialog` con `app.evaluate`.
- Capturas para revisar a ojo: `DBX_SHOTS=<carpeta> npx playwright test …` (las pruebas llaman a `shot(...)`).
