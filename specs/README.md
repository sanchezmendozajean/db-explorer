# DB Explorer — Especificaciones

Cliente de escritorio para explorar y consultar bases de datos **PostgreSQL, MariaDB/MySQL, SQLite y SQL Server**. Inspirado en la distribución de DBeaver, pero con muchas menos opciones, y con el aspecto visual y la edición de código de **VS Code**.

> Nombre provisional: **DB Explorer** (ver `00-decisiones.md`).

## Cómo usar esta carpeta

| Para | Leer |
|---|---|
| Decidir lo pendiente antes de empezar | `00-decisiones.md` |
| Entender qué se construye y qué no | `01-vision-y-alcance.md` |
| Claude Code — arquitectura y stack | `02-arquitectura.md` |
| Claude Code — capa de drivers | `03-drivers-bd.md` |
| Claude Design — maqueta de la interfaz | `04-interfaz.md` + `10-prompt-claude-design.md` |
| Claude Code — editor (Monaco) | `05-editor-sql.md` |
| Claude Code — grilla de resultados | `06-resultados.md` |
| Claude Code — explorador de archivos | `07-explorador-archivos.md` |
| Claude Code — conexiones, credenciales y seguridad | `08-conexiones-y-seguridad.md` |
| Claude Code — orden de construcción | `09-plan-de-implementacion.md` |
| Claude Code — scripts, espacio de trabajo y guardado automático | `11-scripts-y-espacio-de-trabajo.md` |
| Claude Code — plan de ejecución | `12-plan-de-ejecucion.md` |

## Flujo sugerido

1. Resolver `00-decisiones.md` (marcar la opción elegida en cada punto).
2. Generar la maqueta en Claude Design con `10-prompt-claude-design.md` (adjuntando `04-interfaz.md`). Ajustar `04-interfaz.md` si la maqueta cambia algo.
3. En Claude Code, abrir `C:\Coding\db-explorer` y pedir:
   > Lee todos los archivos de `specs/` y construye el hito M0 de `09-plan-de-implementacion.md`. Al terminar cada hito, verifica sus criterios de aceptación y detente para que revise.
4. Avanzar hito por hito (M0 → M9). Cada hito deja la app funcionando.

## Reglas generales para Claude Code

- TypeScript estricto en todo el proyecto. Sin `any` salvo en fronteras con librerías sin tipos.
- Si una spec contradice a otra, prevalece la de número mayor sobre el tema específico (p. ej. `05-editor-sql.md` sobre `02` en lo que toca al editor) y se anota la contradicción en `specs/NOTAS.md`.
- Si falta una definición, elegir la opción más simple que no bloquee futuras extensiones y registrarla en `specs/NOTAS.md`.
- No agregar funcionalidades fuera de `01-vision-y-alcance.md` sin preguntar.
- Nada de telemetría ni llamadas de red salvo las conexiones a BD que el usuario configure.
