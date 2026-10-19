# Historial y mensajes

## Mensajes

La pestaña **Mensajes** del panel de resultados registra cada sentencia que ejecutas:

- La **hora**, la **duración** y las **filas** devueltas o afectadas.
- Los avisos del motor (`NOTICE` en PostgreSQL, `PRINT` en SQL Server).
- Los **errores**, en rojo, con el mensaje del motor y un enlace **Ir a la línea** que lleva el cursor al punto del error.

## Historial

La vista **Historial** de la barra de actividad (el ícono del reloj) lista las consultas que has ejecutado.

| Columna | Contenido |
| --- | --- |
| Fecha | Cuándo se ejecutó |
| Conexión | En qué conexión |
| Duración | Cuánto tardó |
| Filas | Cuántas filas devolvió o afectó |
| Estado | Éxito o error |
| SQL | La primera línea de la sentencia |

- Se puede **filtrar por texto y por conexión**.
- **Doble clic** abre la consulta en un script nuevo; <kbd>Enter</kbd> la inserta en el script actual.
- Se conservan por defecto las últimas **5000** entradas.

### Privacidad

El historial es el **único** lugar donde se guarda el texto de tus consultas, y nunca guarda resultados. Puedes **desactivarlo** y **limpiarlo** en Preferencias. Los registros de la aplicación nunca incluyen contraseñas, cadenas de conexión ni datos de resultados.
