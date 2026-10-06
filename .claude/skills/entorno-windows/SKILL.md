---
name: entorno-windows
description: Particularidades del entorno de desarrollo Windows de DB Explorer (Git Bash, PowerShell, Node, Electron, pg_ctl). Usar antes de escribir comandos de shell, scripts de Node en línea o ediciones masivas de archivos.
---

# Entorno Windows

## Bash (Git Bash) y escapes
- Dentro de `node -e "..."` los acentos graves (`` ` ``) se interpretan como sustitución de comandos: rompen template literals y comentarios. Los `${...}` también se expanden.
- Incluso con heredoc entre comillas (`node <<'EOF'`), `\\` llega como `\` y `\b`, `\n` se vuelven caracteres de control. Una regex como `/\.sql$/` termina como `/.sql$/` sin aviso.
- **Regla**: para editar código con backticks, `${}` o barras invertidas usar las herramientas Write/Edit, no `sed`/`node -e`. En scripts de Node, construir `\` con `String.fromCharCode(92)`.
- `node -e` con reemplazos de texto simples (sin esos caracteres) sí sirve para cambios en varios archivos; verificar el resultado con `grep` después.
- No hay Python instalado (`python` abre la Microsoft Store).
- `sed -i` con `\n` en el reemplazo funciona (GNU sed), pero no con caracteres especiales de JS.

## PowerShell
- Útil para procesos: `Get-CimInstance Win32_Process -Filter "Name='electron.exe'"` muestra línea de comandos y hora de inicio; `taskkill /PID <pid> /T /F` termina el árbol.

## Electron y Node
- La terminal integrada de VS Code exporta `ELECTRON_RUN_AS_NODE=1`: hay que quitarla al lanzar Electron (ya lo hacen `scripts/electron-vite.mjs` y `test/e2e/helpers.ts`), si no Electron arranca como Node.
- Node 24: `node:sqlite` disponible (lo usan el driver SQLite y el historial).
- En Electron 44 `clipboard.readText()` del proceso main es asíncrono: hay que esperarlo.

## PostgreSQL local para pruebas
- `pg_ctl start` lanzado con `execFile` nunca resuelve (el servidor hereda los pipes): usar `spawn` con `stdio: 'ignore'` (ver `test/integration/pg-server.ts`). Se busca la instalación local o `PG_BIN`; si no hay, Docker con `test/integration/docker-compose.yml`.

## Antivirus (Kaspersky) y empaquetado
- El antivirus del equipo bloquea, como "inicio de PowerShell desde un script", que `node.exe` lance PowerShell dentro de la cadena de `npm run`. electron-builder lo hace para listar dependencias y falla con `spawn EPERM`. `npm run package` usa `scripts/electron-builder.mjs`, que lo lanza como proceso directo de Node, y así no se bloquea. No hace falta tocar el antivirus.
- La primera ejecución de un binario recién compilado tarda varios segundos (análisis del antivirus): no la tomes como medida de arranque.
- Extraer el zip de Electron en `dist/` fallaba con EPERM al renombrar (archivos recién escritos bloqueados): el empaquetado usa `electronDist: node_modules/electron/dist`.

## Rutas cortas 8.3
- `%TEMP%` es `C:\Users\JEAN~1.SAN\…` (nombre corto). Chromium deja el `~` tal cual en las URL `file://` y `pathToFileURL` de Node lo codifica como `%7E`: nunca compares URL de archivo como texto; compara rutas (`src/main/file-url.ts`).
- En los heredocs de Bash, `\\` llega como `\` (este mismo texto se rompió así al escribirlo): para scripts de Node con rutas de Windows usa `path.join` o la herramienta Write, no barras invertidas escritas a mano.
