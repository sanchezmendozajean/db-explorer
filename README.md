# DB Explorer

Cliente de escritorio para explorar y consultar bases de datos PostgreSQL, MariaDB/MySQL, SQLite y SQL Server. Electron + React + TypeScript, con editor Monaco y aspecto de VS Code.

Las especificaciones están en [`specs/`](specs/README.md) y el registro de decisiones de implementación en [`specs/NOTAS.md`](specs/NOTAS.md).

## Requisitos

- Node.js 22.12 o superior.
- Para las pruebas de integración y e2e: PostgreSQL instalado localmente (se crea un clúster temporal) o Docker.

## Scripts

| Comando                    | Qué hace                                                                      |
| -------------------------- | ----------------------------------------------------------------------------- |
| `npm install`              | Instala dependencias. Electron descarga su binario en el primer arranque.     |
| `npm run dev`              | Arranca la aplicación en modo desarrollo con recarga en caliente.             |
| `npm run build`            | Chequea tipos y genera el build en `out/`.                                    |
| `npm test`                 | Pruebas unitarias (Vitest).                                                   |
| `npm run test:integration` | Pruebas contra los motores de `test/integration/docker-compose.yml`.          |
| `npm run test:e2e`         | Construye y ejecuta las pruebas de extremo a extremo (Playwright + Electron). |
| `npm run lint`             | ESLint y chequeo de tipos.                                                    |
| `npm run format`           | Formatea con Prettier.                                                        |
| `npm run package`          | Genera el instalador de Windows (NSIS) y la versión portable en `dist/`.      |
| `npm run package:dir`      | Genera solo la carpeta `dist/win-unpacked` (más rápido, para probar).         |
| `npm run test:packaged`    | Empaqueta y recorre la checklist e2e de flujo completo sobre el `.exe`.       |
| `npm run measure`          | Mide el arranque y la memoria en reposo del programa empaquetado.             |
| `npm run icon`             | Regenera `resources/icon.ico` e `icon.png` desde `resources/icon.svg`.        |

### Pruebas de integración y e2e

Necesitan un PostgreSQL de pruebas. Si hay uno escuchando con los datos de `test/integration/.env` (o `.env.example`), se usa; si no, se crea un clúster temporal con los binarios de PostgreSQL instalados (`C:\Program Files\PostgreSQL\<versión>\bin`, o la variable `PG_BIN`) y se borra al terminar.

Con Docker:

```sh
cp test/integration/.env.example test/integration/.env
docker compose -f test/integration/docker-compose.yml --env-file test/integration/.env up -d
npm run test:integration
```

## Empaquetado

`npm run package` deja en `dist/` el instalador (`DB-Explorer-<versión>-instalador.exe`, por usuario y con carpeta elegible) y la versión portable (`DB-Explorer-<versión>-portable.exe`). Ninguno necesita Node instalado. El build aplica los fuses de Electron de `specs/08`, por eso `test:packaged` controla el programa por CDP (`--remote-debugging-port`) y no con el lanzador de Electron de Playwright. Los ejecutables no están firmados: Windows SmartScreen puede pedir confirmación al abrirlos.

`test:packaged` usa `dist/win-unpacked`; para probar el programa instalado o el portable, indica su ruta en `DBX_PACKAGED_EXE`.

## Estructura

```
src/
  main/      proceso principal (ventanas, IPC, servicios)
  db-host/   utilityProcess donde corren los drivers de BD
  preload/   puente mínimo y tipado hacia el renderer
  renderer/  interfaz React
  shared/    contrato IPC y tipos compartidos
test/
  unit/ integration/ e2e/ e2e-packaged/
resources/  ícono de la aplicación
scripts/    lanzadores, generación del ícono y medición de arranque
```
