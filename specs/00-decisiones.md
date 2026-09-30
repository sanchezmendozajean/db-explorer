# 00 — Decisiones pendientes

Cada punto trae una **recomendación** (marcada ✅) que el resto de specs ya asume. Si eliges otra opción, cámbiala aquí y avísale a Claude Code para que ajuste lo afectado.

Formato: marca con `[x]` la opción elegida.

---

### D1. Nombre de la aplicación
- [ ] ✅ Mantener "DB Explorer" como provisional y decidir al empaquetar (M8).
- [ ] Otro: ________

### D2. Framework de UI en el renderer
- [ ] ✅ **React + TypeScript** (ecosistema más amplio para grillas, paneles y árboles; Claude Code lo maneja muy bien).
- [ ] Svelte / SolidJS (más liviano, menos librerías listas).
- [ ] Vanilla + Web Components (control total, más código propio).

### D3. Nivel de integración "VS Code" en el editor
- [ ] ✅ **`monaco-editor` puro**, empaquetado localmente. Da los mismos atajos de edición de VS Code (multicursor, mover líneas, comentar, buscar/reemplazar, plegado, paleta de comandos del editor). Los atajos de *workbench* (Ctrl+B, Ctrl+P, Ctrl+Shift+E, Ctrl+J, Ctrl+Tab…) se implementan a nivel de app (ver `05-editor-sql.md`).
- [ ] `@codingame/monaco-vscode-api`: trae servicios reales de VS Code (keybindings.json, temas .json de VS Code, algunos snippets/extensiones). Más fiel, pero mucho más pesado y complejo de configurar.
- [ ] CodeMirror 6 (más liviano; atajos distintos, habría que emularlos).

### D4. Componente de grilla de resultados
- [ ] ✅ **Glide Data Grid** (canvas, maneja cientos de miles de filas fluidas, edición de celdas, selección tipo hoja de cálculo, MIT).
- [ ] AG Grid Community (muy completo, DOM, más pesado; algunas funciones útiles son Enterprise/pagas).
- [ ] TanStack Table + virtualización propia (máximo control, más trabajo).

### D5. Cambio entre "Conexiones" y "Archivos" en la barra lateral
- [ ] ✅ **Activity Bar a la izquierda** (iconos verticales como VS Code; cada icono cambia la vista de la barra lateral).
- [ ] Pestañas horizontales en la cabecera de la barra lateral (como DBeaver).

### D6. Tema
- [ ] ✅ **Oscuro (VS Code Dark Modern) y Claro (VS Code Light Modern)**, conmutables; por defecto sigue al sistema.
- [ ] Solo oscuro en v1.

### D7. Edición de datos en la grilla (v1)
- [ ] ✅ **Sí**, solo en tablas con clave primaria o única; los cambios quedan pendientes, se previsualiza el SQL generado y se aplican con "Guardar".
- [ ] No en v1 (solo lectura).

### D8. Túnel SSH
- [ ] ✅ **No en v1.** Sí SSL/TLS (necesario para RDS y Azure). SSH se agrega en v2.
- [ ] Sí en v1 (librería `ssh2`).

### D9. Explorador de archivos: raíz
- [ ] ✅ **Una carpeta de trabajo** elegida por el usuario (como "Abrir carpeta" en VS Code), recordada entre sesiones.
- [ ] Varias carpetas simultáneas (multi-root).

### D10. Protección de conexiones de producción
- [ ] ✅ **Etiqueta de entorno por conexión** (Local / Desarrollo / QA / Producción) con color. En Producción: confirmación antes de ejecutar sentencias que modifican datos o estructura, y opción "solo lectura".
- [ ] Solo color, sin confirmaciones.

### D11. Modo de transacción por defecto
- [ ] ✅ **Auto-commit**, con conmutador por pestaña a modo manual (Commit / Rollback visibles en la barra del editor).
- [ ] Manual por defecto.

### D12. Plataforma objetivo
- [ ] ✅ **Windows primero** (instalador NSIS + portable). Código multiplataforma sin garantías de prueba en macOS/Linux.
- [ ] Windows, macOS y Linux desde v1.

### D13. Driver de SQL Server
- [ ] ✅ **`mssql` (tedious)**: JavaScript puro, sin dependencias nativas. Autenticación SQL y Azure AD por usuario/contraseña.
- [ ] `msnodesqlv8`: permite autenticación integrada de Windows, pero es nativo y requiere ODBC Driver instalado.

> Si necesitas **autenticación de Windows** hacia SQL Server, la respuesta en D13 cambia.

### D14. Driver de SQLite
- [ ] ✅ **`better-sqlite3`** (el más rápido y estable; nativo, se recompila para Electron con `electron-rebuild`). Corre en el proceso de BD, no en el principal.
- [ ] `node:sqlite` nativo de Node (sin compilación, API aún experimental según versión de Electron).
