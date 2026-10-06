---
name: flujo-de-trabajo
description: Cómo se trabaja en DB Explorer - hitos, idioma, commits con la identidad correcta, registro de decisiones en NOTAS y recursos siempre empaquetados. Usar al empezar o cerrar un hito, al commitear o al decidir algo que las specs no cubren.
---

# Flujo de trabajo en DB Explorer

Complementa `CLAUDE.md` (que sigue siendo la fuente de las reglas). Aquí va lo aprendido al aplicarlas.

## Hitos
- Un hito a la vez según `specs/09-plan-de-implementacion.md`. Antes de empezar: leer el hito, la spec que referencia y la sección del hito anterior en `specs/NOTAS.md`.
- Al terminar: verificar cada criterio de aceptación con una prueba (integración en los cuatro motores cuando aplica, e2e para la interfaz), correr **todo** (unitarias, integración, e2e, `npm run lint`, `npx prettier --check src test`) y detenerse para revisión.
- El informe al usuario (en español) cubre: criterios de aceptación y cómo se verificaron, qué puede probar, cambios respecto a la spec, lo corregido de paso, números de pruebas y pendientes. Termina con "reinicia `npm run dev`".
- `specs/NOTAS.md` lleva una sección por hito con: tabla de criterios, qué se construyó, decisiones y pendientes/avisos. Toda desviación de la spec o definición faltante se anota ahí (opción más simple). Si la spec describe un modelo o contrato que cambió, se actualiza también la spec (p. ej. `specs/02`, `specs/12 §3`).
- No agregar funcionalidades fuera de `specs/01` sin preguntar. Arreglar bugs encontrados de paso sí, y anotarlos en NOTAS ("Corregido de paso").

## Empaquetado
- `npm run package` genera el instalador NSIS (por usuario) y el portable en `dist/`; `npm run package:dir`, solo `dist/win-unpacked`. Ícono: editar `resources/icon.svg` y correr `npm run icon`.
- Las dependencias que necesitan main o el db-host en tiempo de ejecución van en `dependencies`; todo lo del renderer, en `devDependencies` (Vite lo empaqueta y así no entra en `app.asar`).
- El nombre "DB Explorer" sigue provisional (D1): cambiarlo es tocar `productName`/`appId` en `electron-builder.yml` y los textos de `es.ts`.

## Commits
- Identidad del repositorio: `sanchezmendozajean <jp.sanchez.6383@gmail.com>`, configurada en `.git/config` local. **Nunca** el correo corporativo del equipo y **nunca** cambiar la configuración global de git. Verificar con `git config user.email` antes de commitear en un equipo nuevo.
- Mensajes en español, en imperativo, pequeños por tema (p. ej. db-host / renderer / pruebas / documentación por separado). Terminan con la línea de coautoría que indique el sistema.
- Commitear o hacer push solo cuando el usuario lo pide o al cerrar las piezas de un hito aprobado.

## Idioma
- Conversación, documentación, comentarios JSDoc, mensajes de commit y textos de UI en español. Identificadores, SQL y nombres de librerías en inglés.
- Textos de UI solo en `src/renderer/i18n/es.ts`. Ojo con plurales (`1 fila` / `n filas`) y números con `toLocaleString('es')` (20 000 → `20.000`).

## Recursos empaquetados (exigencia del usuario)
- Todas las tipografías, íconos y estilos van dentro del proyecto y del programa. La app nunca descarga fuentes ni estilos: nada de CDN ni Google Fonts.
- Usar paquetes npm con los archivos (`@vscode/codicons`, `@fontsource/cascadia-code`) importados desde el bundle. Fuentes no redistribuibles (Segoe UI) solo como fuente del sistema.
- Lenguajes de Monaco disponibles: los registrados en `src/renderer/features/editor/monaco/setup.ts` (sql, pgsql, mysql, markdown, xml, yaml, javascript, json). Uno nuevo se registra ahí.
- Dependencias nuevas solo si la spec las autoriza (p. ej. `fast-xml-parser` en specs/12) o preguntando.

## Datos sensibles
- Credenciales de servidores de prueba solo en `test/integration/.env` (ignorado por git). Nunca en commits, skills, logs ni mensajes.
