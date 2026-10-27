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

## Preferencias y accesibilidad (M9)
- Preferencias se arma con datos (`PrefEntry`: ícono (codicon, obligatorio), título, descripción, palabras clave, `modified`, `onReset`, `render`): el buscador filtra las entradas sin tildes (`pref-search.ts`) y oculta los grupos vacíos. Agrega un ajuste nuevo como otra entrada del grupo.
- Los tokens de color deben pasar `test/unit/contrast.test.ts` (texto 4,5:1, indicadores 3:1) en ambos temas. Si un token cambia, corre esa prueba.
- F6 / Shift+F6 recorren las partes del workbench (`PARTS` en `app-commands.ts`). El panel de resultados está dentro de `.editor-group`: para saber dónde está el foco se toma la parte más específica (`findLastIndex`).
- Un input visualmente oculto (checkbox) necesita un contenedor `position: relative`; si no, queda debajo de otro elemento posicionado, que se lleva los clics.
- Ctrl+1 / Ctrl+2 enfocan en el cuadro siguiente (`requestAnimationFrame`): en las pruebas, espera ese foco antes de mover el foco a mano.
- El renderer se minifica (`minify: true` en `electron.vite.config.ts`); Monaco se carga recién con el primer script (chunk `setup`).

## Árboles, atajos y editores (aprendido al cerrar pendientes)
- `VirtualTree`: `onSelect(id, { ctrl, shift })` y `selectedIds` permiten selección múltiple (los árboles de selección simple ignoran el segundo argumento). Las teclas que no dependen de una fila (escribir para filtrar) van en `onTreeKeyDown`: `onRowKeyDown` solo corre si hay una fila seleccionada y el filtro puede ocultarla.
- Los proveedores SQL de Monaco (`registerSqlProviders`) se registran al montar cada editor que los necesite (SqlEditor, ClauseEditor, RoutineView): si una vista nueva no lo hace, el autocompletado cae en las palabras del texto. Un modelo que no es documento del espacio se asocia a su pestaña con `setModelOwner`.
- Los acordes de dos teclas dentro de Monaco se registran con `syncAppChords` a partir de `keybindings.allRules()`; no reemplazan a los que Monaco ya trae (p. ej. Ctrl+K Ctrl+J).
- La grilla Glide es un canvas: tras abrir el visor de valor la grilla se angosta; las pruebas deben recalcular coordenadas (usar la primera columna) y para deshacer usar el botón "Descartar cambios".

## Editor dividido (dos grupos)
- Un editor Monaco por grupo: `activeEditor()` devuelve el del grupo enfocado (el de la pestaña activa); para hallar el que muestra un documento usar `editorShowing(model)`. No guardar una referencia "actual" global.
- `useWorkbenchStore.activeId` es la pestaña enfocada; la visible de cada grupo es `groupActive[g]`. Toda escritura pasa por `normalize` en el store: no tocar `groupActive` a mano. Las operaciones por posición (Ctrl+Tab, Alt+N) deben limitarse al grupo enfocado.
- Hay dos `.editor-group` a la vez: los selectores de foco y las pruebas e2e deben acotar por grupo (`.editor-group[data-group="1"]` o `.nth()`). El panel de resultados es uno solo (`data-testid="results"`), fuera de los grupos, y sigue a la pestaña enfocada (`EditorArea`).
