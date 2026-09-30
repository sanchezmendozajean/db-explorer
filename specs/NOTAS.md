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
