# CLAUDE.md — DB Explorer

## Idioma (obligatorio)
- **Todas las conversaciones con el usuario deben ser en español.**
- **Toda la documentación generada debe estar en español**: README, archivos en `specs/`, `specs/NOTAS.md`, comentarios de documentación (JSDoc/TSDoc), mensajes de commit, descripciones de PR, changelogs y textos de la interfaz.
- Se mantienen en inglés únicamente los identificadores de código (variables, funciones, tipos, archivos), las palabras clave de SQL y los nombres propios de librerías o APIs.

## Proyecto
Cliente de escritorio para explorar y consultar bases de datos PostgreSQL, MariaDB/MySQL, SQLite y SQL Server. Distribución inspirada en DBeaver, estilo visual de VS Code, editor Monaco. Construido con Electron + React + TypeScript.

## Especificaciones
- Antes de cualquier tarea, lee `specs/README.md` y los archivos de `specs/` relevantes.
- `specs/00-decisiones.md` contiene las decisiones tomadas; respétalas.
- Construye siguiendo los hitos de `specs/09-plan-de-implementacion.md`, uno a la vez. Al terminar cada hito, verifica sus criterios de aceptación y detente para revisión.
- Si una definición falta o dos specs se contradicen, elige la opción más simple y regístrala en `specs/NOTAS.md`.
- No agregues funcionalidades fuera de `specs/01-vision-y-alcance.md` sin preguntar.

## Conocimiento aprendido
- Lo aprendido durante la implementación vive en `.claude/skills/` (versionado con el proyecto): `flujo-de-trabajo`, `entorno-windows`, `pruebas`, `motores-y-drivers` y `renderer-ui`. Consultar la skill del tema antes de trabajar en él y actualizarla cuando se aprenda algo nuevo que no se deduzca del código.

## Reglas de código
- TypeScript estricto; sin `any` salvo en fronteras con librerías sin tipos.
- Seguridad según `specs/08-conexiones-y-seguridad.md`: nunca guardar ni registrar contraseñas en texto plano, ni registrar datos de resultados.
- Sin telemetría ni llamadas de red, salvo las conexiones a bases de datos que configure el usuario.
- Textos de UI centralizados en `src/renderer/i18n/es.ts`.
- Commits pequeños, mensaje en español en imperativo (p. ej. "Agrega driver de MariaDB").
