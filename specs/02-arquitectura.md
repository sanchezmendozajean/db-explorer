# 02 — Arquitectura y stack

## Stack
| Área | Elección |
|---|---|
| Runtime | Electron (última estable) |
| Build | `electron-vite` (Vite para main, preload y renderer) |
| Lenguaje | TypeScript estricto |
| UI | React 18+ (D2) |
| Estado | Zustand (stores pequeños por dominio) |
| Paneles redimensionables | `react-resizable-panels` |
| Árboles | Componente propio virtualizado (`@tanstack/react-virtual`) |
| Editor | `monaco-editor` empaquetado local (D3) — ver `05` |
| Grilla | Glide Data Grid (D4) — ver `06` |
| Iconos | `@vscode/codicons` |
| Formato SQL | `sql-formatter` |
| Drivers | `pg`, `mysql2`, `better-sqlite3`, `mssql` — ver `03` |
| Exportación XLSX | `exceljs` |
| Validación | `zod` (config, mensajes IPC) |
| Tests | Vitest (unit), Docker Compose + Vitest (integración drivers), Playwright para Electron (e2e) |
| Empaquetado | `electron-builder` (NSIS + portable en Windows) |
| Lint/format | ESLint + Prettier |

## Procesos

```
┌──────────────────────┐   IPC tipado (contextBridge)   ┌──────────────────────┐
│ Renderer (React)     │ ─────────────────────────────▶ │ Main                 │
│ UI, Monaco, grilla   │ ◀───────────────────────────── │ ventanas, menú,      │
│ sin acceso a Node    │        eventos/streams          │ config, archivos,    │
└──────────────────────┘                                 │ credenciales         │
                                                         └─────────┬────────────┘
                                                                   │ MessagePort
                                                         ┌─────────▼────────────┐
                                                         │ DB Host              │
                                                         │ (utilityProcess)     │
                                                         │ drivers y pools      │
                                                         └──────────────────────┘
```

- **Main**: ciclo de vida, ventana sin marco (title bar propio), menú nativo oculto (el menú se dibuja en el title bar como VS Code), acceso a disco, `safeStorage`, `settings.json`, watchers de archivos.
- **DB Host** (`utilityProcess`): todos los drivers corren aquí. Aísla bloqueos (better-sqlite3 es síncrono) y caídas nativas. Si se cae, main lo reinicia y el renderer muestra "Conexiones reiniciadas".
- **Renderer**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. Solo accede a `window.api` expuesto por el preload.

## Contrato IPC
- Definido en `src/shared/ipc.ts` como un único tipo con canales request/response y canales de eventos. Todos los payloads se validan con zod en main.
- Nombres por dominio: `conn:*`, `meta:*`, `query:*`, `fs:*`, `settings:*`, `app:*`.
- Resultados grandes: el DB Host envía filas en **lotes** (p. ej. 500 filas) por evento `query:rows` con `queryId`; el renderer acumula. Nunca serializar 100 000 filas en un solo mensaje.
- Cancelación: `query:cancel(queryId)` → el driver ejecuta su mecanismo nativo (ver `03`).

## Estructura de carpetas
```
db-explorer/
  specs/
  src/
    main/            # proceso principal
      windows/
      services/      # config, credentials, files, workspace, autosave, history
      ipc/
    db-host/         # utilityProcess
      drivers/
        postgres/ mariadb/ sqlite/ sqlserver/
      pool.ts
    preload/
    renderer/
      app/           # layout, title bar, activity bar, status bar
      features/
        connections/ explorer-tree/ files/ workspace/ editor/ results/ settings/ history/
      components/    # UI genérica estilo VS Code (botones, inputs, menús, diálogos)
      theme/         # tokens de color dark/light
      stores/
    shared/          # tipos, contrato IPC, esquemas zod, splitter/ (separador de sentencias, ver 05)
  test/
    integration/     # docker-compose.yml con postgres, mariadb, mssql
    e2e/
```

## Persistencia (carpeta `userData`)

Los scripts `.sql` **no** viven aquí: viven en el espacio de trabajo (ver `11`).

| Archivo | Contenido |
|---|---|
| `connections.json` | Conexiones sin secretos (id, nombre, motor, host, puerto, usuario, base, carpeta, entorno, color, opciones SSL). |
| `secrets.bin` | Contraseñas cifradas con `safeStorage`, indexadas por id de conexión. |
| `settings.json` | Preferencias del usuario, incluida la ruta del espacio de trabajo (`workspace.path`) y el guardado automático (editable en Monaco con esquema JSON y autocompletado). |
| `keybindings.json` | Atajos personalizados (opcional, formato similar a VS Code). |
| `ui-state.json` | Estado global de la UI: tamaños de paneles, vista activa de la side bar, carpetas recientes. |
| `workspaces/<hash>.json` | Estado de cada espacio de trabajo: pestañas, orden, pestaña activa, viewState, conexión por archivo (ver `11`). |
| `history.sqlite` | Historial de consultas (texto, conexión, fecha, duración, filas, error). |

## Rendimiento
- Árbol: carga perezosa por nodo; metadatos cacheados por conexión con "Refrescar" (F5 en el árbol).
- Grilla: virtualización por canvas; límite de filas por defecto 500 con "Cargar más" / "Cargar todo".
- Monaco: una sola instancia de editor con un `ITextModel` por pestaña (cambiar pestaña = `setModel` + restaurar viewState).
