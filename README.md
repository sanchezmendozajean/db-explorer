# DB Explorer

Cliente de escritorio para explorar y consultar bases de datos PostgreSQL, MariaDB/MySQL, SQLite y SQL Server. Electron + React + TypeScript, con editor Monaco y aspecto de VS Code.

Las especificaciones están en [`specs/`](specs/README.md) y el registro de decisiones de implementación en [`specs/NOTAS.md`](specs/NOTAS.md).

## Requisitos

- Node.js 22.12 o superior.
- Docker (solo para las pruebas de integración).

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
| `npm run package`          | Genera el instalador de Windows (NSIS + portable) en `dist/`.                 |

### Pruebas de integración

```sh
cp test/integration/.env.example test/integration/.env
docker compose -f test/integration/docker-compose.yml --env-file test/integration/.env up -d
npm run test:integration
```

## Estructura

```
src/
  main/      proceso principal (ventanas, IPC, servicios)
  db-host/   utilityProcess donde corren los drivers de BD
  preload/   puente mínimo y tipado hacia el renderer
  renderer/  interfaz React
  shared/    contrato IPC y tipos compartidos
test/
  unit/ integration/ e2e/
```
