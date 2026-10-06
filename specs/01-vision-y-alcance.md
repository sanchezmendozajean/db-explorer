# 01 — Visión y alcance

## Problema
DBeaver es potente pero pesado: editor de código limitado frente a VS Code, demasiadas opciones de poco uso y configuración de formatos de datos engorrosa.

## Objetivo
Una herramienta enfocada en tres cosas, hechas muy bien:

1. **Explorar**: árbol de conexiones → bases → esquemas → tablas/vistas/funciones → columnas/índices.
2. **Escribir y ejecutar SQL** con un editor idéntico en comportamiento a VS Code (Monaco).
3. **Ver y ajustar resultados** en una grilla rápida, con formatos de datos fáciles de cambiar.

Más un **explorador de archivos** editable para organizar y abrir scripts `.sql`.

## Motores soportados (v1)
| Motor | Versiones mínimas objetivo |
|---|---|
| PostgreSQL | 12+ (incluye Amazon RDS / Aurora PostgreSQL) |
| MariaDB / MySQL | MariaDB 10.5+, MySQL 8+ (probado con MySQL 26.7; ver `NOTAS.md` §MySQL) |
| SQLite | 3.35+ (archivo local) |
| SQL Server | 2016+ (incluye Azure SQL) |

## Dentro del alcance (v1)
- Gestión de conexiones (crear, editar, duplicar, eliminar, probar, carpetas/grupos, color y entorno).
- Árbol de objetos con carga perezosa, filtro de texto y acciones de clic derecho básicas.
- Pestañas de editor SQL asociadas a una conexión y base/esquema activos.
- Ejecución: sentencia bajo el cursor, selección o script completo; cancelación; múltiples resultados.
- Autocompletado de tablas, columnas, esquemas y palabras clave del dialecto.
- Formateo de SQL.
- Grilla de resultados: orden, filtro rápido, copiar (celdas, filas, con cabeceras, como INSERT), exportar CSV/JSON/XLSX, vista de valor (JSON, texto largo), formatos por tipo configurables.
- Edición de datos en grilla (según D7).
- Abrir tabla: ver datos (con filtro WHERE y orden) y ver estructura (columnas, índices, claves, DDL).
- Historial de consultas ejecutadas.
- Plan de ejecución estimado y real en una vista de árbol común a los cuatro motores, con avisos y detalle por paso (ver `12`).
- Scripts como archivos `.sql` en un **espacio de trabajo** (carpeta por defecto del usuario, configurable), con **guardado automático** opcional y restauración de pestañas al abrir (ver `11`).
- Explorador de archivos del espacio de trabajo: crear/renombrar/mover/eliminar archivos y carpetas, abrir en el editor, guardar.
- Temas claro/oscuro estilo VS Code.
- Persistencia: pestañas abiertas por espacio de trabajo, tamaños de paneles, tema.

## Fuera del alcance (v1)
- Diagramas ER, diagrama gráfico del plan de ejecución, diseñador visual de tablas, comparadores de esquema, generadores de datos.
- Administración de servidor (usuarios, roles, sesiones, backups).
- Importación de datos desde archivos (v2).
- Túnel SSH (v2, ver D8).
- Extensiones / plugins de terceros.
- Motores NoSQL.
- Sincronización en la nube de configuración.

## Principios
- **Menos es más**: cada opción nueva debe justificar su lugar. Configuraciones avanzadas viven en un `settings.json` editable en Monaco (como VS Code), con una UI simple solo para lo más común.
- **Teclado primero**: todo lo frecuente tiene atajo; los atajos imitan VS Code.
- **Rápido**: arranque en frío < 2 s en equipo de oficina; abrir un árbol o una tabla no debe congelar la UI jamás.
- **Seguro por defecto**: credenciales cifradas, nada sale del equipo salvo las conexiones a BD.
