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
