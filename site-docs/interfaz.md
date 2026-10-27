# La interfaz

DB Explorer toma la distribución de DBeaver (árbol a la izquierda, editor arriba, resultados abajo) con el lenguaje visual de VS Code: superficies planas, íconos Codicons y densidad compacta.

![La ventana principal](/img/screenshot-light.png){.shot}

## Las partes de la ventana

- **Barra de título.** A la izquierda, los menús <span class="ui">Archivo</span>, <span class="ui">Editar</span>, <span class="ui">Ver</span>, <span class="ui">Consulta</span> y <span class="ui">Ayuda</span>. En el centro, el *command center*: un buscador que abre la paleta de comandos. A la derecha, minimizar, maximizar y cerrar.
- **Barra de actividad.** La columna de íconos de la izquierda cambia la vista de la barra lateral: **Conexiones**, **Archivos** e **Historial**. En la parte inferior, el engranaje abre un menú con Preferencias, Atajos de teclado y Tema. Un clic en el ícono activo contrae la barra lateral.
- **Barra lateral.** Muestra el árbol de conexiones, los archivos del espacio de trabajo o el historial de consultas.
- **Grupo de editores.** Pestañas de scripts, de objetos (tablas y vistas), de rutinas y de preferencias. Cada pestaña de script tiene su barra con los botones de ejecución, la conexión, la base o el esquema activos y el modo de transacción.
- **Panel de resultados.** Debajo del editor (ocupa todo el ancho aunque lo dividas), con las pestañas <span class="ui">Resultado</span>, <span class="ui">Plan</span> y <span class="ui">Mensajes</span>.
- **Barra de estado.** Muestra la conexión activa y la versión del motor, la posición del cursor, el estado del autoguardado, la codificación, el fin de línea, el lenguaje y el modo de transacción.

## Dividir el editor

<kbd>Ctrl</kbd>+<kbd></kbd>, el botón de la barra de pestañas, <span class="ui">Ver › Dividir editor</span> o <span class="ui">Dividir a la derecha</span> en el menú de la pestaña abren un **segundo grupo** de pestañas al lado. Cada grupo tiene su barra de pestañas y su editor; el **panel de resultados es uno solo**, de ancho completo, y muestra el de la pestaña enfocada.

- Una pestaña pertenece a un solo grupo: pásala al otro con el mismo comando, con el menú o arrastrándola a su barra de pestañas.
- Un clic en un grupo lo enfoca; ejecutar, guardar, cerrar y <kbd>Ctrl</kbd>+<kbd>Tab</kbd> actúan sobre el grupo enfocado.
- Si el grupo derecho se queda sin pestañas desaparece; el botón <span class="ui">Juntar con el grupo izquierdo</span> las devuelve todas al principal.
- La división se restaura al reiniciar.

La ventana también recuerda su **posición, tamaño y si estaba maximizada**; si el monitor ya no está conectado, se abre centrada.

## Colores por entorno

Cada conexión tiene un entorno (Local, Desarrollo, QA o Producción) con su color. Ese color aparece en el punto del árbol, en el borde superior de las pestañas asociadas y en la barra de estado. **Producción se tiñe de rojo** para que nunca confundas dónde estás ejecutando.

## Temas

El tema puede ser **Claro**, **Oscuro** o **Según el sistema**. Cámbialo en <span class="ui">Preferencias › Apariencia</span> o desde el menú del engranaje.

## Paleta de comandos y apertura rápida

- <kbd>Ctrl</kbd>+<kbd>P</kbd> busca **objetos de base de datos** (tablas, vistas y funciones de las conexiones abiertas) y **archivos** del espacio de trabajo. Enter lo abre.
- <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> o <kbd>F1</kbd> muestra los **comandos** de la aplicación con su atajo.
- <kbd>Ctrl</kbd>+<kbd>9</kbd> cambia la conexión de la pestaña y <kbd>Ctrl</kbd>+<kbd>0</kbd> cambia la base o el esquema.

## Moverte con el teclado

Todo lo frecuente tiene atajo y se parecen a los de VS Code. <kbd>F6</kbd> y <kbd>Shift</kbd>+<kbd>F6</kbd> recorren las zonas de la ventana (barra de actividad, barra lateral, editor, resultados y barra de estado). Consulta la [lista completa de atajos](./atajos).

## Zoom y paneles

- <kbd>Ctrl</kbd>+<kbd>=</kbd> y <kbd>Ctrl</kbd>+<kbd>-</kbd> acercan y alejan toda la interfaz; <kbd>Ctrl</kbd>+<kbd>0</kbd> del teclado numérico restablece el zoom.
- <kbd>Ctrl</kbd>+<kbd>B</kbd> muestra u oculta la barra lateral.
- <kbd>Ctrl</kbd>+<kbd>J</kbd> muestra u oculta el panel de resultados y <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>J</kbd> lo maximiza.
- Los tamaños de los paneles se recuerdan entre sesiones.

## Notificaciones

Los avisos aparecen abajo a la derecha, como en VS Code. Desaparecen solos a los pocos segundos, salvo los errores y los que piden una decisión.
