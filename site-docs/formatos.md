# Formatos de datos

Cómo se *muestran* los números, las fechas, los booleanos, los nulos y los binarios en la grilla. El principio es **un solo lugar, pocos ajustes y vista previa inmediata**.

Los formatos solo cambian la presentación: los valores siguen siendo los crudos del motor, y así se copian y exportan (salvo que elijas «con formato»).

## Tres niveles

Del más general al más específico:

1. **Global por tipo**, en <span class="ui">Preferencias › Formatos de datos</span>.
2. **Por conexión** (opcional), que reemplaza al global. Útil, por ejemplo, para una base en otra zona horaria. Se elige en *Aplicar a*, dentro de la misma pantalla.
3. **Por columna**, en el resultado actual: clic derecho › <span class="ui">Formato de columna</span>, sin salir de la grilla. Con <span class="ui">Recordar para tabla.columna</span> la regla se guarda.

## Qué puedes ajustar

| Tipo | Ajustes | Ejemplo |
| --- | --- | --- |
| **Decimal** | Modo (como está en la base, fijo o sin ceros sobrantes), decimales y separadores | `999999999.00` → `999,999,999.00` |
| **Fecha y hora** | Patrón (con valores predefinidos o libre) y milisegundos (siempre, nunca o cuando existan) | `2026-09-30 08:42:52.658` |
| **Fecha y hora con zona** | Mostrar como está, en hora local o en UTC | |
| **Booleano** | Casilla, `true/false`, `1/0` o `sí/no` | ☑ |
| **Nulo** | El texto que se muestra (`NULL`, vacío, `∅`…) | `NULL` |
| **Binario** | Hexadecimal, Base64 o tamaño, con un máximo de bytes | `0x89504E47…` |
| **JSON** | Compacto o con sangría (el visor siempre usa sangría) | |
| **Texto largo** | Longitud máxima visible en la celda | |

Cada fila de la pantalla tiene una **vista previa en vivo** con un valor de ejemplo y un botón **Restablecer**.

Además puedes alinear una columna a la izquierda, a la derecha o al centro desde su menú.

## Opciones de la grilla

También se ajustan en Preferencias: el límite de filas por defecto, las filas alternadas y el tamaño de letra de la grilla.
