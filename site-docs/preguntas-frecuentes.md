# Preguntas frecuentes

## ¿Es gratis? ¿Necesito una cuenta?

Es gratis, de código abierto bajo licencia MIT y no pide cuenta ni inicio de sesión.

## ¿Qué sistemas operativos soporta?

Windows 10 y 11 de 64 bits. El código también compila para Linux, pero el instalador que se publica es el de Windows.

## ¿Envía algo a internet?

No. La aplicación no tiene telemetría ni llamadas de red. Solo se conecta a las bases de datos que tú configuras. Ver [Seguridad](./seguridad).

## Windows dice «Windows protegió su PC». ¿Es seguro?

El instalador todavía no está firmado digitalmente, y por eso SmartScreen avisa. Pulsa <span class="ui">Más información</span> y luego <span class="ui">Ejecutar de todos modos</span>. El código es abierto y cada versión se compila en GitHub Actions a partir de él.

## ¿Dónde se guardan mis scripts?

En tu [espacio de trabajo](./espacio-de-trabajo): por defecto `Documentos\DB Explorer`. Cada script es un archivo `.sql` normal que puedes abrir con cualquier editor o versionar con Git.

## ¿Dónde se guardan las conexiones y las contraseñas?

En la carpeta de datos de la aplicación de tu usuario de Windows. Las contraseñas van cifradas con tu usuario de Windows y nunca en texto plano.

## No puedo guardar contraseñas

Si el sistema no tiene cifrado disponible, DB Explorer **no guarda contraseñas** y la pide en cada conexión. El diálogo de la conexión lo avisa.

## ¿Por qué mi resultado no se puede editar?

Un resultado solo es editable si proviene de **una sola tabla** y contiene todas las columnas de su clave primaria. Si no, la grilla es de solo lectura y un mensaje lo explica. Abre la tabla desde el árbol para editarla con seguridad. Ver [Editar datos](./edicion).

## ¿Por qué el plan real no está disponible en SQLite?

SQLite no entrega filas ni tiempos reales por paso, así que solo se puede pedir el plan estimado.

## ¿Puedo importar datos desde un archivo?

Todavía no: la importación está planificada para una versión futura. Hoy puedes [exportar](./exportar) a CSV, JSON, XLSX o SQL, y pegar desde Excel en la grilla.

## ¿Hay túnel SSH, diagramas ER o comparación de esquemas?

No en la versión actual. DB Explorer se centra en explorar, consultar y ver resultados.

## ¿Respalda y restaura bases de datos?

Sí, en PostgreSQL, MariaDB/MySQL y SQL Server. En PostgreSQL y MariaDB/MySQL necesitas aportar las herramientas de línea de comandos, porque no se distribuyen con la aplicación. Ver [Administrar bases de datos](./administrar-bases).

## ¿Cómo cambio entre tema claro y oscuro?

<span class="ui">Preferencias › Apariencia › Tema</span>, o el engranaje de la barra de actividad.

## ¿Cómo reporto un error o sugiero algo?

Abre un [issue en GitHub](https://github.com/sanchezmendozajean/db-explorer/issues). Si es un error, indica el motor y su versión, y evita incluir datos sensibles.
