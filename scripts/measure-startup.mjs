/**
 * Mide el arranque y la memoria en reposo del programa empaquetado (specs/09 M9).
 * Uso: `node scripts/measure-startup.mjs [ruta del .exe] [repeticiones]`
 * (por defecto `dist/win-unpacked/DB Explorer.exe` y 5 repeticiones).
 *
 * Arranque: desde que se lanza el proceso hasta la marca `dbx-listo` del
 * renderer (primer cuadro de la interfaz pintado). La primera repetición usa
 * un `userData` nuevo (primer uso); las demás lo reutilizan.
 * Memoria: tras 10 s sin actividad, suma del conjunto de trabajo y de la
 * memoria privada de todos los procesos de la app (main, renderer, GPU,
 * red y db-host).
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const exe = resolve(process.argv[2] ?? 'dist/win-unpacked/DB Explorer.exe');
const runs = Number(process.argv[3] ?? 5);
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Procesos del árbol de `pid` con su memoria (PowerShell, sin dependencias). */
function treeMemory(pid) {
  const json = execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount | ConvertTo-Json -Compress',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const all = JSON.parse(json);
  const ids = new Set([pid]);
  for (let changed = true; changed;) {
    changed = false;
    for (const p of all) {
      if (ids.has(p.ParentProcessId) && !ids.has(p.ProcessId)) {
        ids.add(p.ProcessId);
        changed = true;
      }
    }
  }
  const mine = all.filter((p) => ids.has(p.ProcessId));
  const mb = (n) => Math.round(n / 1024 / 1024);
  return {
    processes: mine.length,
    workingSetMb: mb(mine.reduce((s, p) => s + Number(p.WorkingSetSize), 0)),
    privateMb: mb(mine.reduce((s, p) => s + Number(p.PrivatePageCount), 0)),
  };
}

async function launch(userData, measureMemory) {
  const env = { ...process.env, DBX_USER_DATA_DIR: userData };
  delete env.ELECTRON_RUN_AS_NODE;
  const started = Date.now();
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`], { env, stdio: 'ignore' });
  let browser;
  while (!browser) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    } catch {
      await sleep(25);
    }
  }
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.waitForEvent('page'));
  await page.waitForFunction(() => performance.getEntriesByName('dbx-listo').length > 0, null, {
    timeout: 30_000,
  });
  const readyAt = await page.evaluate(
    () => performance.timeOrigin + performance.getEntriesByName('dbx-listo')[0].startTime,
  );
  let memory = null;
  if (measureMemory) {
    await sleep(10_000);
    memory = treeMemory(child.pid);
  }
  await browser.close();
  execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  await sleep(1000);
  return { startupMs: Math.round(readyAt - started), memory };
}

const userData = mkdtempSync(join(tmpdir(), 'dbx-medicion-'));
const times = [];
let memory = null;
for (let i = 0; i < runs; i++) {
  const result = await launch(userData, i === runs - 1);
  times.push(result.startupMs);
  memory = result.memory ?? memory;
  console.log(`arranque ${i + 1}${i === 0 ? ' (primer uso)' : ''}: ${result.startupMs} ms`);
}
rmSync(userData, { recursive: true, force: true });
const sorted = [...times].sort((a, b) => a - b);
console.log(
  `mediana: ${sorted[Math.floor(sorted.length / 2)]} ms · mínimo ${sorted[0]} ms · máximo ${sorted.at(-1)} ms`,
);
console.log(
  `memoria en reposo (10 s): ${memory.workingSetMb} MB de conjunto de trabajo, ${memory.privateMb} MB privados, ${memory.processes} procesos`,
);
