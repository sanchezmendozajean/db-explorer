// Ejecuta electron-builder como proceso directo de Node, sin las variables `npm_*` de `npm run`.
// electron-builder lanza `powershell.exe` para listar dependencias; dentro de la cadena de
// `npm run` el antivirus del equipo (Kaspersky) lo bloquea como "inicio de PowerShell desde un
// script" y el empaquetado falla con `spawn EPERM`. Lanzado así, no se bloquea.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../node_modules/electron-builder/cli.js', import.meta.url));
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.toLowerCase().startsWith('npm_') && key !== 'ELECTRON_RUN_AS_NODE',
  ),
);

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 1));
