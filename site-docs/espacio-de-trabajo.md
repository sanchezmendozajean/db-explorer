# Scripts y espacio de trabajo

## Todo script es un archivo

<kbd>Ctrl</kbd>+<kbd>N</kbd> crea **de inmediato** un archivo `.sql` en disco, dentro de tu espacio de trabajo. No existen scripts «en memoria».

- Se llama `Script-N.sql`, donde N es el menor número libre en esa carpeta.
- El archivo nuevo queda asociado a la conexión desde la que lo creaste (la seleccionada en el árbol o la de la pestaña activa).
- Para renombrarlo, usa <kbd>F2</kbd> sobre la pestaña o en la vista [Archivos](./archivos). Se renombra el archivo en disco.
- Si cierras la pestaña de un script **vacío**, el archivo se elimina (se puede desactivar). Al cerrar el programa, los scripts vacíos abiertos no se eliminan: se restauran como las demás pestañas.

## El espacio de trabajo

Es **una carpeta** donde se crean todos tus scripts y que muestra la vista Archivos.

- **Por defecto** es `Documentos\DB Explorer`, y se crea sola en el primer arranque.
- **Cambiarlo**: <span class="ui">Archivo › Cambiar espacio de trabajo…</span>, <span class="ui">Preferencias › Archivos</span> o la paleta de comandos. La ruta elegida se recuerda y es la que se abre siempre al iniciar.
- Al cambiar, se guardan los archivos con cambios (o se pregunta por cada uno), se cierran las pestañas y se abre el nuevo espacio con **sus** pestañas, si ya lo habías usado. Los scripts existentes **no se mueven** de carpeta.
- El título de la ventana muestra el nombre del espacio y el buscador de la barra de título lo usa como referencia.
- **Archivo › Abrir espacio reciente** lista los últimos 10.
- Si el espacio **no está disponible** al iniciar (carpeta borrada, unidad de red desconectada), un modal te deja **Reintentar**, **Elegir otra carpeta** o **Usar el predeterminado**.

Con <kbd>Ctrl</kbd>+<kbd>O</kbd> puedes abrir un `.sql` de cualquier parte del disco: funciona igual, aunque no aparezca en el árbol de Archivos.

## Se restaura todo al volver

Al cerrar y abrir la aplicación vuelves a donde estabas:

- las mismas **pestañas**, en el mismo orden y con la misma pestaña activa;
- el **cursor y el desplazamiento** de cada editor;
- la **conexión, base y esquema** de cada script;
- las pestañas de objeto, **sin conectar** hasta que las enfoques.

Si un archivo de la lista ya no existe, se omite y una notificación te avisa con la opción de ver cuáles faltan.

El estado de cada espacio se guarda en la carpeta de datos de la aplicación, **no dentro de tu carpeta de scripts**. Así, si subes esa carpeta a un repositorio, no compartes los nombres de tus conexiones.

## Guardado automático

Se configura en <span class="ui">Preferencias › Archivos</span> y viene **activado**.

### Con el guardado automático activado

El archivo se guarda:

1. **5 segundos después de que dejas de escribir** (configurable de 1 a 60 segundos).
2. **Al ejecutar** una sentencia o un script de esa pestaña: se guarda *antes* de enviar el SQL al motor.
3. **Al cerrar el programa**, sin preguntar.
4. Al cerrar una pestaña y al cambiar de espacio de trabajo.

Mientras hay cambios sin guardar se ve un punto `●` en la pestaña. La barra de estado muestra **Autoguardado** y un clic lo activa o desactiva.

### Con el guardado automático desactivado

- Solo se guarda con <kbd>Ctrl</kbd>+<kbd>S</kbd> (o Guardar todo). Ejecutar no guarda.
- Cerrar una pestaña con cambios pregunta: **Guardar**, **No guardar** o **Cancelar**.
- Cerrar el programa con cambios muestra un solo diálogo con la lista de archivos modificados.

### Reglas que siempre se cumplen

- La escritura es **atómica** (archivo temporal y renombrado): un archivo nunca queda a medias.
- Se conservan la **codificación**, el **BOM** y el **fin de línea** originales.
- Si un archivo **cambió por fuera** de la aplicación, no se sobrescribe: una notificación te deja **Comparar** (con el diff de Monaco), **Sobrescribir** o **Recargar**.
- Si el guardado falla (solo lectura, disco lleno, unidad desconectada), se avisa, el punto `●` se mantiene y se reintenta en el siguiente disparador.
