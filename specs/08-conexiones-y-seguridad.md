# 08 — Conexiones, credenciales y seguridad

La herramienta se usará contra bases con datos sensibles (p. ej. planillas). La seguridad es requisito, no extra.

## Modelo de conexión
```ts
interface ConnectionConfig {
  id: string;                    // uuid
  name: string;
  engine: 'postgres' | 'mariadb' | 'sqlite' | 'sqlserver';
  folder?: string;
  environment: 'local' | 'dev' | 'qa' | 'prod';
  color?: string;                // sobrescribe el del entorno
  host?: string; port?: number; instance?: string;   // sqlserver
  database?: string; user?: string;
  file?: string; sqliteReadOnly?: boolean; sqliteCreate?: boolean;
  savePassword: boolean;
  ssl?: { mode: 'disable' | 'require' | 'verify-ca' | 'verify-full'; caFile?: string;
          encrypt?: boolean; trustServerCertificate?: boolean };
  readOnly: boolean;
  confirmWrites: boolean;        // true por defecto si environment = prod
  connectTimeoutSec: number;     // 15
  queryTimeoutSec: number;       // 0 = sin límite
  extra?: Record<string, string>;
  showSystemObjects: boolean;
}
```
Validado con zod al leer `connections.json`; entradas inválidas se omiten con aviso, nunca se pierde el archivo (backup `connections.json.bak` antes de cada escritura, escritura atómica: temp + rename).

## Credenciales
- Contraseñas cifradas con `safeStorage.encryptString` (DPAPI del usuario en Windows) y guardadas en `secrets.bin`. Nunca en `connections.json`, `session.json`, logs ni en mensajes de error.
- Si `safeStorage.isEncryptionAvailable()` es falso: no guardar contraseñas (se piden al conectar) y avisarlo en el diálogo.
- Sin "Guardar contraseña": se pide al conectar y se mantiene solo en memoria del DB Host mientras dure la sesión.
- El renderer **nunca recibe** una contraseña guardada: main la descifra y la pasa directo al DB Host. El diálogo de edición muestra `••••••••` y solo envía la nueva si el usuario la cambia.
- Exportar/importar conexiones (v1 opcional): exporta sin contraseñas.

## Protección de entornos (D10)
- **Clasificación de sentencias** (en `shared/`, usando el splitter + primera palabra clave significativa tras comentarios y CTEs):
  - Lectura: `SELECT`, `WITH … SELECT`, `SHOW`, `DESCRIBE`, `EXPLAIN` (sin `ANALYZE`), `PRAGMA` de lectura.
  - Escritura de datos: `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `UPSERT`, `REPLACE`, `TRUNCATE`, `COPY … FROM`, `EXPLAIN ANALYZE` de escritura.
  - Estructura: `CREATE`, `ALTER`, `DROP`, `RENAME`, `GRANT`, `REVOKE`.
  - Desconocido (procedimientos `CALL`/`EXEC`, bloques `DO`): tratar como escritura.
- `confirmWrites` → modal de `04` §14 antes de ejecutar escrituras/estructura.
- **Siempre** (cualquier entorno) advertir `UPDATE`/`DELETE` sin `WHERE` con modal de confirmación.
- `readOnly` → bloquear en cliente las sentencias no-lectura con mensaje claro, **y** además, a nivel servidor cuando sea posible:
  - Postgres: `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` al abrir sesión.
  - MariaDB: `SET SESSION TRANSACTION READ ONLY`.
  - SQLite: abrir con `readonly: true`.
  - SQL Server: `ApplicationIntent=ReadOnly` no garantiza solo lectura → depender del bloqueo en cliente y recomendar usuario con permisos de lectura (documentarlo en el diálogo).
- Status bar teñida y borde de pestaña rojo en Producción (ver `04`).

## Seguridad de Electron
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
- CSP estricta en el renderer: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; worker-src 'self' blob:; connect-src 'self'`. (Monaco requiere `worker-src blob:` según empaquetado; verificar.)
- Bloquear navegación y `window.open` (`setWindowOpenHandler` → deny; `will-navigate` → prevent). Enlaces externos solo vía `shell.openExternal` con allowlist `https:`.
- Preload expone una API mínima y tipada; nada de exponer `ipcRenderer` completo.
- Validar con zod todo payload IPC en main.
- Fuses de Electron en el build: deshabilitar `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`; habilitar `EnableCookieEncryption`, `OnlyLoadAppFromAsar`.
- Sin telemetría, sin auto-actualización en v1 (o solo desde un origen configurado por el usuario).
- DevTools deshabilitadas en builds de producción salvo flag `--dev-tools`.

## Registro (logs)
- Log de la app en `userData/logs/` con rotación (`electron-log`). Nunca registrar contraseñas, cadenas de conexión completas ni **datos de resultados**. El texto SQL solo se guarda en el historial (que el usuario puede limpiar y desactivar: `history.enabled`).

## Datos en memoria y disco
- Resultados solo en memoria; no se cachean en disco.
- `session.json` guarda texto de scripts no guardados (puede contener datos si el usuario los pegó): documentarlo y ofrecer `session.restoreUnsaved: false`.
- Botón "Limpiar historial" y "Olvidar contraseñas guardadas" en Preferencias.
