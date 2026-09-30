# 10 — Prompt para Claude Design

Copia el bloque siguiente en Claude Design y adjunta `04-interfaz.md` (y opcionalmente capturas de VS Code y DBeaver como referencia de estilo y distribución).

---

```
Diseña la maqueta de alta fidelidad de una aplicación de escritorio llamada "DB Explorer": un cliente de bases de datos (PostgreSQL, MariaDB, SQLite, SQL Server).

Distribución inspirada en DBeaver (árbol de conexiones a la izquierda, editor SQL arriba, grilla de resultados abajo), pero con el lenguaje visual EXACTO de Visual Studio Code (tema Dark Modern y Light Modern): superficies planas, bordes de 1 px, iconos Codicons, fuente Segoe UI 13 px para la interfaz y Cascadia Code para el código, densidad compacta, sin degradados ni sombras salvo en menús y diálogos.

Sigue al pie de la letra el documento adjunto "04-interfaz.md": estructura, medidas, tokens de color, iconos, textos y contenido de cada zona. Todos los textos de la interfaz en español.

Tamaño de lienzo: 1600 × 1000 px (ventana Windows sin marco, con title bar propia).

Pantallas a entregar (sección 17 del documento):
1. Principal en tema oscuro: vista Conexiones con el árbol expandido (una conexión "PayBox Prod" de Producción en rojo con base "paybox", esquema "public" y tablas; una conexión "local" verde; "SGA TEST" ámbar; un archivo SQLite "requerimientos.db"). Pestañas de editor: "Script-1", "● Script-2" (activa), "CRendiciones_Conf_Generales". El editor muestra 6 consultas SQL de PostgreSQL con nombres de tabla entrecomillados, la última resaltada como sentencia activa. Resultados con ~15 filas y columnas: id (entero), Nombre (texto), FechaDeCreacion (timestamp), ImporteLimite (decimal), Activo (booleano), Observacion (con valores NULL). Status bar teñida de rojo por ser Producción.
2. La misma pantalla en tema claro.
3. Vista Archivos con la carpeta "scripts-paybox" abierta, subcarpetas y archivos .sql; un archivo abierto sin cambios y otro con cambios (●).
4. Pestaña de tabla en subpestaña "Datos", con filtro WHERE, 3 celdas editadas (fondo amarillo), 1 fila nueva (verde), 1 fila marcada para eliminar (roja) y el botón primario "Guardar (5)".
5. Diálogo "Nueva conexión" para PostgreSQL con el resultado "Conectado — PostgreSQL 16.2 (42 ms)".
6. Paleta rápida (Ctrl+P) abierta buscando "rendic", con tablas y archivos como resultados.
7. Menú contextual sobre una tabla del árbol y menú contextual sobre una celda de la grilla (con submenú "Copiar como" abierto).
8. Modal de confirmación de escritura en Producción mostrando un UPDATE.

Entrega además una hoja de componentes: botones (primario, secundario, icono), inputs, selects/chips de conexión, pestañas (activa, inactiva, con cambios, preview en cursiva, con borde de color de entorno), nodos del árbol en sus estados (normal, hover, seleccionado, conectando, error), cabecera de columna de la grilla con icono de tipo y orden, toast de notificación.
```

---

## Después de la maqueta
- Si la maqueta introduce cambios que te gustan (medidas, textos, iconos), actualízalos en `04-interfaz.md` para que Claude Code los siga.
- Exporta las pantallas como PNG a `specs/maqueta/` y referencia en `04-interfaz.md`: "Ver `maqueta/01-principal-oscuro.png`". Claude Code puede leer esas imágenes para comparar su implementación en M1.
