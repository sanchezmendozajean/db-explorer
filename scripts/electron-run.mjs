// Ejecuta un script con el binario de Electron del proyecto, sin ELECTRON_RUN_AS_NODE
// (las terminales integradas de VS Code la heredan y harían arrancar Electron como Node).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const electron = createRequire(import.meta.url)('electron');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, process.argv.slice(2), { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 1));
