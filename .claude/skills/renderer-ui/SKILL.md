---
name: renderer-ui
description: Lecciones del renderer de DB Explorer (React 19, zustand, Monaco 0.57, Glide Data Grid, react-resizable-panels, TanStack Virtual, comandos y atajos) - trampas de foco, CSS y estado. Usar antes de tocar src/renderer.
---

# Renderer: lecciones aprendidas

## Comandos, atajos y menús
- Todo pasa por el registro de comandos `db.*` (`src/renderer/commands/registry.ts`); menús, paleta, botones y atajos lo ejecutan. `enabled` deshabilita; `disabledReason` pone el motivo como tooltip en los menús.
- Atajos por defecto en `default-keybindings.ts` (fuente: specs/05). El manejador global escucha en **fase de captura** y gana la **última** regla habilitada que coincide. Los contextos `when` salen de `data-focus-context` del elemento con foco (`editorFocus`, `gridFocus`, `treeFocus`, `planFocus`, `inputFocus`…).
- Un atajo sin regla global (p. ej. Ctrl+C en un árbol propio) se maneja con `onKeyDown` local.
- Los menús deben respetar el orden de specs/04 (incluidos los separadores).

## Monaco
- Monaco 0.57 usa **EditContext**: un `<label>` que envuelve al editor manda el foco a su textarea oculta y el editor deja de recibir escritura. Envolver con `<div>`.
- Reglas CSS genéricas como `.clase span` alcanzan los `span` internos de Monaco: limitar al hijo directo (`.clase > span`).
- Una sola carga diferida (`monaco/loader.ts`); temas `db-light`/`db-dark`. Para texto de solo lectura usar `features/editor/ReadOnlyCode.tsx`.

## Glide Data Grid
- Dibuja en canvas: los datos no están en el DOM. La grilla expone `data-columns`, `data-column-widths`, `data-editable`, `data-result-id` y `data-undo-depth` para pruebas y depuración.
- El editor de celda es controlado y aplica el texto en un cuadro posterior (ver skill `pruebas`).
- Los colores salen de variables CSS leídas en tiempo de ejecución (`cssVar`), para seguir el tema.

## React y estado
- Un componente reutilizado entre pestañas sin `key` conserva el estado de la anterior (la segunda pestaña de objeto no cargaba): usar `key={tab.id}`.
- Cambiar el padre de un elemento lo vuelve a montar y **pierde el foco** (Esc dejaba de llegar al árbol del plan al abrir el detalle). Mantener la estructura estable y mostrar u ocultar solo el panel extra.
- Nada de asignar refs durante el render (lint del React Compiler): moverlo a `useLayoutEffect`.
- Para quitar una clave de un objeto usar `withoutKey` (`src/shared/records.ts`), no `delete obj[k]` (regla `no-dynamic-delete`).
- Store de settings optimista: un `settings:changed` atrasado no debe pisar un valor que se está guardando (se conservan los valores en curso al hidratar).
- Los resultados llegan en lotes; el store agrupa las filas por cuadro de animación (`requestAnimationFrame`). En pruebas unitarias hay que simular `requestAnimationFrame`.
- La respuesta de `query:execute` puede llegar antes que los últimos lotes: terminar una ejecución con el evento `execution-done`, no con la respuesta del IPC.

## Componentes
- `react-resizable-panels` (v4): tamaños en px; pone `data-testid` igual al `id` del `Panel`.
- `VirtualTree` (TanStack Virtual): filas ya aplanadas; con alto variable (`rowSize`) hay que llamar a `virtualizer.measure()` cuando cambian las filas, porque TanStack no recalcula las estimaciones solo. El árbol tiene `overflow-x: hidden` (sin desplazamiento horizontal).
- Columnas alineadas en un árbol-tabla: restar la sangría (margen 8 + chevron 18 + nivel × sangría) al ancho de la primera columna; `scrollbar-gutter: stable` en cabecera y cuerpo.
- Textos de UI solo en `i18n/es.ts`; estilos con los tokens de `theme/tokens.css` (claro y oscuro).
