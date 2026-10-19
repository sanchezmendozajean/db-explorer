# Introducción

DB Explorer es un cliente de escritorio para explorar y consultar bases de datos. Soporta **PostgreSQL**, **MariaDB/MySQL**, **SQLite** y **SQL Server**, con el editor de VS Code (Monaco), una grilla de resultados rápida y un aspecto que te resultará familiar si usas VS Code.

![DB Explorer con un script y sus resultados](/img/screenshot-dark.png){.shot}

Esta guía explica todas sus características. Si es tu primera vez, lee esta página, [Conexiones](./conexiones) y [Ejecutar consultas](./ejecucion). El resto puedes consultarlo cuando lo necesites.

## Qué lo hace distinto

- **Enfocado en tres cosas.** Explorar el árbol de objetos, escribir y ejecutar SQL, y ver y ajustar los resultados. Sin diseñadores, sin administración de servidor, sin opciones de poco uso.
- **Un editor de verdad.** Es Monaco, el mismo de VS Code: multicursor, plegado, buscar y reemplazar, autocompletado y los mismos atajos.
- **Tus scripts son archivos.** Cada script es un `.sql` en una carpeta de tu equipo (el [espacio de trabajo](./espacio-de-trabajo)), con guardado automático y pestañas que se restauran al volver.
- **Seguro por defecto.** Las contraseñas van cifradas con el sistema, los entornos de producción se marcan en rojo y piden confirmación, y la aplicación no hace telemetría ni llamadas de red. Más en [Seguridad](./seguridad).
- **Ligero.** Abre en menos de dos segundos y consume poca memoria en reposo.

## Motores compatibles

| Motor | Versiones |
| --- | --- |
| PostgreSQL | 12 o superior (incluye Amazon RDS y Aurora PostgreSQL) |
| MariaDB / MySQL | MariaDB 10.5 o superior, MySQL 8 o superior |
| SQLite | 3.35 o superior (archivo local) |
| SQL Server | 2016 o superior (incluye Azure SQL) |

## Instalación

1. Descarga el instalador desde la [página de la última versión](https://github.com/sanchezmendozajean/db-explorer/releases/latest). Es el archivo `DB-Explorer-<versión>-instalador.exe`.
2. Ejecútalo. Puedes elegir la carpeta de instalación y si quieres un acceso directo en el escritorio.
3. Al terminar, abre DB Explorer desde el menú Inicio o el acceso directo.

Funciona en Windows 10 y Windows 11 de 64 bits. Si prefieres no instalar nada, descarga la **versión portable** (`DB-Explorer-<versión>-portable.exe`) y ejecútala donde quieras.

::: warning «Windows protegió su PC»
El instalador todavía no está firmado digitalmente, así que Windows SmartScreen puede mostrar ese aviso la primera vez. Pulsa <span class="ui">Más información</span> y luego <span class="ui">Ejecutar de todos modos</span>.
:::

## Tu primera consulta en un minuto

1. Pulsa el botón <span class="ui">Nueva conexión</span> de la barra lateral, elige el motor y completa los datos. Para probar sin servidor, elige **SQLite** y marca <span class="ui">Crear si no existe</span>. Detalles en [Conexiones](./conexiones).
2. Haz doble clic en la conexión para conectarla y expandirla.
3. Pulsa <kbd>Ctrl</kbd>+<kbd>N</kbd> para abrir un script nuevo, asociado a esa conexión.
4. Escribe una consulta, por ejemplo `select 1`, y pulsa <kbd>Ctrl</kbd>+<kbd>Enter</kbd>.
5. Los resultados aparecen en la grilla de abajo.

::: tip Consejo
<kbd>Ctrl</kbd>+<kbd>P</kbd> abre cualquier tabla, vista o archivo escribiendo parte de su nombre, y <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> muestra todos los comandos con su atajo.
:::

## Dónde guarda las cosas

| Qué | Dónde |
| --- | --- |
| Tus scripts | Una carpeta de tu equipo, por defecto `Documentos\DB Explorer` |
| Conexiones y preferencias | La carpeta de datos de la aplicación en tu usuario de Windows |
| Contraseñas | Cifradas con tu usuario de Windows, nunca en texto plano |
| Resultados de consultas | Solo en memoria; no se guardan en disco |
