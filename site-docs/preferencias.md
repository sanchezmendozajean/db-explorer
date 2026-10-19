# Preferencias

Se abren con <kbd>Ctrl</kbd>+<kbd>,</kbd>, desde el engranaje de la barra de actividad o desde la paleta de comandos.

## Dos formas de configurar

Como en VS Code, hay dos modos:

- **La interfaz**: una lista agrupada con un **buscador**. Cada ajuste muestra su descripción y, si lo cambiaste, un botón para **restablecer** su valor.
- **`settings.json`**: un archivo que se edita en el propio editor (botón <span class="ui">Abrir settings.json</span>). Aquí viven también los ajustes avanzados.

## Grupos

| Grupo | Qué incluye |
| --- | --- |
| **Editor** | Tamaño de fuente, tabulación, ajuste de línea, números de línea y separador de sentencias. El resto de opciones de Monaco se cambian en `settings.json` bajo `editor.*` |
| **Archivos** | Espacio de trabajo, guardado automático y su retraso, eliminar scripts vacíos al cerrar |
| **Resultados** | Límite de filas, filas alternadas, tamaño de letra de la grilla, qué se escribe en lugar de `NULL` al copiar, y el historial de consultas |
| **Formatos de datos** | Cómo se muestran números, fechas, booleanos, nulos y binarios, con vista previa en vivo. Ver [Formatos de datos](./formatos) |
| **Apariencia** | Tema: Claro, Oscuro o Según el sistema |

Las conexiones **no** están aquí: cada una se configura en su propio diálogo. Ver [Conexiones](./conexiones).

## Historial y contraseñas

En Preferencias están también los botones <span class="ui">Limpiar historial</span> y <span class="ui">Olvidar contraseñas guardadas</span>, además de la opción para desactivar el historial. Ver [Historial y mensajes](./historial).

## Atajos de teclado

Se personalizan en `keybindings.json`, con el formato de VS Code. Ver [Atajos de teclado](./atajos#personalizar-los-atajos).
