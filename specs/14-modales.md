# 14 — Modales

Rediseño visual del componente `Modal` (`src/renderer/components/Modal.tsx`) y de todos los diálogos que lo usan. El cambio principal es un **encabezado distintivo que siempre lleva un ícono**, cuyo color comunica la intención del diálogo. Se construye en el hito M11 (`09`).

Maqueta de referencia (Claude Design): <https://claude.ai/artifact/WWtVUB6R14vTMWVHZvJBZ6> — mesas *Respaldo en curso*, *Anatomía del encabezado*, *Variantes por intención*, *Restaurar en Producción*, *Pedir contraseña* y *Tema claro*. Si la maqueta y esta spec difieren, **prevalece esta spec**.

## 1. Alcance

- Es un cambio **visual y de API del componente**. No cambia flujos, validaciones, textos de confirmación ni comportamiento de ningún diálogo, salvo lo indicado explícitamente en §7.
- Fuera de alcance, aunque aparezcan en la maqueta como ilustración: selectores de Formato y Contenido en el respaldo, "seguir el respaldo en segundo plano", contador de tiempo transcurrido, campo "escribe el nombre para confirmar" en la restauración. La restauración conserva su checkbox actual "Entiendo que se reemplazarán los datos".
- No se agregan librerías. Iconos: `@vscode/codicons` mediante el componente `Codicon` existente.

## 2. Anatomía

```
┌──────────────────────────────────────────────────────────────┐
│ [■]  Título del diálogo                        [PROD]   [×]  │  ← encabezado (banda tintada)
│      ● PayBox Prod · postgres · host:5432                    │
├──────────────────────────────────────────────────────────────┤  ← borde inferior de intención
│ cuerpo                                                       │
├──────────────────────────────────────────────────────────────┤
│ nota (opcional, izquierda)            [Secundario] [Primario]│  ← pie
└──────────────────────────────────────────────────────────────┘
```

| Elemento | Especificación |
|---|---|
| Contenedor `.modal` | Fondo `--bg-editor`, borde 1 px `--border-menu`, **radio 8 px**, `overflow: hidden`, sombra `--shadow-dialog`. |
| Encabezado `.modal-header` | `display: flex; align-items: center; gap: 12px; padding: 14px 12px 14px 16px`. Fondo `--intent-<i>-bg`, borde inferior 1 px `--intent-<i>-border`. Alto resultante ≈ 60 px con subtítulo. |
| Baldosa del ícono `.modal-icon` | 32 × 32 px, radio 6 px, fondo `--intent-<i>-tile`, `flex: none`, centrada. Contiene `<Codicon name={icon} size={18} />` con color `--intent-<i>-fg`. **Siempre presente.** Decorativa (`aria-hidden`). |
| Bloque de textos | `flex: 1; min-width: 0`. |
| Título `h2` | 14 px, peso 600, `--fg` (en oscuro se puede usar `#ececec` vía token `--fg-strong`, ver §3), alto de línea 18 px. Conserva `id` para `aria-labelledby`. |
| Subtítulo `.modal-subtitle` | 12 px, `--fg-muted`, alto de línea 16 px, `margin-top: 2px`, una sola línea con `text-overflow: ellipsis`. Se enlaza con `aria-describedby`. |
| Chip de entorno `.modal-env-chip` | Solo para conexiones `qa` y `prod`. 11 px, peso 700, `letter-spacing: .04em`, padding `2px 6px`, radio 3 px. Textos en `es.ts`: "QA" y "PROD". Colores: `prod` → fondo `--status-prod-bg`, texto `--intent-danger-fg` (oscuro: `#ffb4ae`, ver §3); `qa` → fondo `--intent-warning-tile`, texto `--intent-warning-fg`. |
| Botón cerrar | `IconButton` existente (`close`), 28 × 28 px, a la derecha. Se oculta cuando `dismissible` es `false` (§4). |
| Cuerpo `.modal-body` | Padding `16px 20px`. Sin cambios de comportamiento (scroll, `bodyClassName`). |
| Pie `.modal-footer` | Fondo `--bg-panel`, borde superior 1 px `--border`, padding `12px 16px`, botones a la derecha con `gap: 8px`. `.footer-left` se mantiene para notas o checkboxes a la izquierda. |

Los botones (`Button`) **no cambian** (radio 2 px, variantes actuales).

## 3. Tokens nuevos (`src/renderer/theme/tokens.css`)

Cuatro intenciones × cuatro tokens, en ambos temas. Valores tomados de la maqueta (oscuro) y calculados con la misma proporción sobre `#ffffff` (claro):

| Token | Oscuro | Claro |
|---|---|---|
| `--intent-info-bg` | `#1c2831` | `#ebf3fa` |
| `--intent-info-border` | `#143e5e` | `#b3d0ea` |
| `--intent-info-tile` | `#193143` | `#d3e4f5` |
| `--intent-info-fg` | `#4aa3ff` | `#005fb8` |
| `--intent-warning-bg` | `#302d1c` | `#f7f3eb` |
| `--intent-warning-border` | `#5b4f14` | `#ded2b3` |
| `--intent-warning-tile` | `#423a19` | `#efe9db` |
| `--intent-warning-fg` | `#e2b714` | `#916702` |
| `--intent-danger-bg` | `#392524` | `#fdedeb` |
| `--intent-danger-border` | `#6b302e` | `#f5b9b3` |
| `--intent-danger-tile` | `#4b2928` | `#fadedb` |
| `--intent-danger-fg` | `#f96b64` | `#dc1300` |
| `--intent-success-bg` | `#212c23` | `#f0f6ef` |
| `--intent-success-border` | `#2a5532` | `#c4dcc3` |
| `--intent-success-tile` | `#223926` | `#e3eee2` |
| `--intent-success-fg` | `#3fb950` | `#388a34` |
| `--fg-strong` | `#ececec` | `#1f1f1f` |
| `--env-chip-prod-fg` | `#ffb4ae` | `#a1260d` |

- Marcar los tokens con el comentario `/* (14-modales) */`.
- Contraste (WCAG AA): `--fg-muted` y `--fg-strong` sobre los cuatro `--intent-*-bg` deben dar ≥ 4,5:1; `--intent-*-fg` sobre `--intent-*-tile` ≥ 3:1 (indicador gráfico); el texto del chip sobre su fondo ≥ 4,5:1. Agregar estos pares a `test/unit/contrast.test.ts`. Si algún par no cumple, ajustar **lo mínimo** el token y anotarlo en `NOTAS.md`.

## 4. API del componente

```ts
export type ModalIntent = 'info' | 'warning' | 'danger' | 'success';

export interface ModalProps {
  title: string;
  /** Nombre de Codicon del encabezado. Obligatorio: todo modal muestra un ícono. */
  icon: string;
  /** Color del encabezado. Por defecto 'info'. */
  intent?: ModalIntent;
  /** Línea secundaria en texto libre. Se ignora si se pasa `connection`. */
  subtitle?: string;
  /**
   * Contexto de conexión: dibuja en el subtítulo el punto de entorno, el nombre,
   * la base (si se indica) y la dirección, y agrega el chip QA/PROD.
   */
  connection?: { config: ConnectionConfig; database?: string; showAddress?: boolean };
  /** Si es false, se oculta el botón cerrar y Esc / clic fuera no cierran. Por defecto true. */
  dismissible?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  bodyClassName?: string;
  closeOnBackdrop?: boolean;
}
```

- **Se elimina `accentColor`** (y con él el borde superior de 3 px). TypeScript obliga a revisar cada llamada.
- `intent` agrega la clase `is-<intent>` al `.modal`; el CSS resuelve los tokens con esa clase. No usar estilos en línea para los colores.
- Subtítulo con `connection`: `<span class="env-dot">` con `dotStyle(config.color ?? var(--env-<environment>))`, nombre en `--fg`, y separados por ` · ` la base y la dirección (`connectionAddress`, que hoy vive en `BackupDialog`: moverla a un módulo compartido, p. ej. `src/renderer/features/connections/address.ts`). `showAddress` por defecto `true`.
- Chip: se calcula a partir de `config.environment`; nunca se pasa a mano.
- Foco, trampa de Tab, retorno del foco y portal: **sin cambios**.

## 5. Bloques reutilizables del cuerpo (`components.css`)

| Clase | Uso | Estilo |
|---|---|---|
| `.modal-callout` + `.is-warning` / `.is-danger` / `.is-info` | Avisos dentro del cuerpo (advertencia de restauración, texto de escritura en Producción). Reemplaza `.form-hint.is-warning` **dentro de modales**. | Fondo `--intent-<i>-bg`, borde 1 px `--intent-<i>-border`, radio 6 px, padding `12px 14px`. Primera línea opcional `.modal-callout-title` en peso 600 y color `--intent-<i>-fg`. |
| `.modal-progress` | Estado "en curso" (respaldo, restauración, herramientas). | Fondo `--bg-panel`, borde 1 px `--border`, radio 6 px, padding `12px 14px`, columna con `gap: 10px`: fila con `Codicon loading` girando + texto, barra indeterminada de 4 px (pista `--border`, relleno `--accent`, animación de desplazamiento), y nota en 12 px `--fg-muted`. Con `prefers-reduced-motion: reduce` la barra queda fija al 35 %. |

## 6. Migración de diálogos

Cada llamada a `<Modal>` pasa a tener `icon` e `intent`. Lista actual (verificar con `grep -rn "<Modal" src` por si hay nuevas):

| Archivo | Diálogo | `icon` | `intent` | Contexto en encabezado |
|---|---|---|---|---|
| `dialogs/Dialogs.tsx` | Acerca de | `info` | info | — |
| `dialogs/Dialogs.tsx` | Atajos de teclado | `keyboard` | info | — |
| `dialogs/ChoiceDialogs.tsx` | `ChoiceDialog` (genérico) | el del pedido; por defecto `question` | el del pedido; por defecto info | — |
| `dialogs/ChoiceDialogs.tsx` | `WriteConfirmDialog` | `warning` | danger | `connection` (sin base); el chip PROD sale solo |
| `dialogs/ChoiceDialogs.tsx` | `SqlPreviewDialog` | `code` | info (warning si trae `warning`) | — |
| `dialogs/SimpleDialogs.tsx` | `ConfirmDialog` | el del pedido; por defecto `warning` si `danger`, si no `question` | danger si `danger`, si no info | — |
| `dialogs/SimpleDialogs.tsx` | `PromptDialog` | el del pedido; por defecto `edit` | danger si `danger`, si no info | — |
| `dialogs/SimpleDialogs.tsx` | `PasswordDialog` | `key` | info | `connection` (con dirección) |
| `connections/ConnectionDialog.tsx` | Elegir motor (nueva conexión) | `plug` | info | — |
| `connections/ConnectionDialog.tsx` | Nueva / editar conexión | `plug` | info | `subtitle` = nombre del motor; el título deja de llevar " — Motor" |
| `db-admin/BackupDialog.tsx` | Respaldar | `cloud-download` | info | `connection` con `database` |
| `db-admin/BackupDialog.tsx` | Restaurar | `cloud-upload` | danger en Producción, warning en el resto | `connection` con base destino |
| `db-admin/ToolsDialog.tsx` | Herramientas | `tools` | info | — |
| `results/ExportDialog.tsx` | Exportar | `export` | info | — |
| `editor/CompareDialog.tsx` | Comparar | `diff` | info | — |

- `askChoice`, la confirmación y el *prompt* del `overlay-store` ganan campos opcionales `icon?: string` e `intent?: ModalIntent`. Revisar las llamadas existentes y asignar un ícono específico cuando el genérico no describa la acción (p. ej. `trash` al eliminar, `discard` al descartar cambios).
- Validar que cada nombre de ícono exista en `@vscode/codicons`; si alguno no existe, usar el más cercano y anotarlo en `NOTAS.md`.

## 7. Cambios puntuales de contenido

1. **Respaldar**: se eliminan del cuerpo los campos "Conexión" y "Base de datos", porque ahora van en el subtítulo. Los `data-testid="backup-connection"` y `"backup-database"` se trasladan a los elementos del subtítulo (nombre de conexión y base) para que las pruebas e2e sigan funcionando.
2. **Restaurar**: se elimina el campo "Host destino" (`restore-host`) del cuerpo por la misma razón; su `data-testid` pasa al nombre de conexión del subtítulo. La advertencia `restoreWarning` se muestra en un `.modal-callout.is-warning` (o `.is-danger` en Producción) en vez de `.form-hint`.
3. **Respaldo/restauración/herramientas en curso**: el texto "Respaldando… puede tardar según el tamaño de la base" pasa a un `.modal-progress`. Mientras corre, `dismissible={!running}` (hoy `onClose` ya ignora el cierre; ahora además se oculta la ×). La versión de la herramienta (`pg_dump.exe 18.6`) se muestra en `.footer-left` del pie con `--font-code` 11 px `--fg-muted`.
4. **Escritura en Producción**: el texto "Vas a ejecutar N sentencias… en **PayBox Prod** (Producción)" pasa a un `.modal-callout.is-danger`.

Ningún texto nuevo se escribe en línea: todo va a `src/renderer/i18n/es.ts` (chips "QA" / "PROD").

## 8. Criterios de aceptación

- Todos los modales muestran el encabezado tintado con ícono; ninguno conserva el borde superior de 3 px; `accentColor` ya no existe en el código.
- Respaldar sobre una conexión de Producción muestra ícono azul, subtítulo "● PayBox Prod · postgres · host" y chip PROD, y el cuerpo ya no repite conexión ni base.
- Restaurar en Producción muestra el encabezado rojo; en Dev o Local, ámbar.
- Confirmación de escritura en Producción: encabezado rojo con chip PROD y aviso en `.modal-callout.is-danger`; el foco por defecto sigue en **Cancelar**.
- Durante un respaldo en curso no hay botón cerrar y Esc no cierra.
- Se ve correcto en tema oscuro y claro; el test de contraste cubre los pares de §3 y pasa.
- Pruebas unitarias, de integración y e2e existentes siguen pasando (ajustar solo selectores que dependían del borde o de los campos movidos).
- Sin warnings de TypeScript ni de ESLint.
