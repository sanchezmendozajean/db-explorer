import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

/**
 * El instalador (NSIS, silencioso) corre con la aplicación ya cerrada, así que la ventana de avance
 * no puede ser de Electron: es un proceso aparte (PowerShell + WinForms) con una barra indeterminada.
 * Espera a que termine este proceso y a que el programa instalado vuelva a abrirse; si eso no ocurre
 * (instalación fallida o sin reinicio), se cierra sola al cumplirse el tiempo máximo.
 */
const SCRIPT = `param([string]$Title, [string]$Message, [string]$ProcessName, [int]$OldPid, [int]$TimeoutSeconds)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.Text = $Title
$form.ClientSize = New-Object System.Drawing.Size(380, 96)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.ControlBox = $false
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true
$form.ShowInTaskbar = $true
$label = New-Object System.Windows.Forms.Label
$label.Text = $Message
$label.AutoSize = $false
$label.Location = New-Object System.Drawing.Point(16, 16)
$label.Size = New-Object System.Drawing.Size(348, 24)
$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Style = 'Marquee'
$bar.MarqueeAnimationSpeed = 30
$bar.Location = New-Object System.Drawing.Point(16, 52)
$bar.Size = New-Object System.Drawing.Size(348, 22)
$form.Controls.Add($label)
$form.Controls.Add($bar)
$started = Get-Date
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 500
$timer.Add_Tick({
  $old = Get-Process -Id $OldPid -ErrorAction SilentlyContinue
  $new = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $OldPid }
  $elapsed = ((Get-Date) - $started).TotalSeconds
  if ((-not $old -and $new -and $elapsed -gt 3) -or $elapsed -gt $TimeoutSeconds) {
    Start-Sleep -Milliseconds 800
    $timer.Stop()
    $form.Close()
  }
})
$timer.Start()
[void]$form.ShowDialog()
`;

/** Anota una línea en el registro de la actualización; nunca lanza (no debe impedir instalar). */
function logLine(file: string | undefined, text: string): void {
  if (!file) return;
  try {
    appendFileSync(
      file,
      `${new Date().toISOString()} ${text}
`,
      'utf8',
    );
  } catch {
    // Sin registro la instalación sigue igual.
  }
}

/**
 * Abre la ventana de avance de la actualización (solo Windows); los errores no impiden instalar.
 * Si PowerShell no arranca o termina enseguida (p. ej. un antivirus lo bloquea), queda anotado en
 * `logFile` para poder diagnosticarlo.
 */
export function showUpdateProgress(texts: { title: string; message: string; logFile?: string }): void {
  if (process.platform !== 'win32') return;
  try {
    const file = join(tmpdir(), 'db-explorer-actualizando.ps1');
    // PowerShell 5.1 solo lee UTF-8 con BOM: sin él los acentos se corrompen.
    writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SCRIPT, 'utf8')]));
    const processName = basename(process.execPath).replace(/\.exe$/i, '');
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-File',
        file,
        '-Title',
        texts.title,
        '-Message',
        texts.message,
        '-ProcessName',
        processName,
        '-OldPid',
        String(process.pid),
        '-TimeoutSeconds',
        '180',
      ],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    const startedAt = Date.now();
    logLine(texts.logFile, `Ventana de avance: PowerShell lanzado (pid ${child.pid ?? 'ninguno'})`);
    child.on('error', (err) =>
      logLine(texts.logFile, `Ventana de avance: no se pudo lanzar PowerShell: ${err.message}`),
    );
    child.on('exit', (code, signal) => {
      const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
      // Debe vivir hasta que el programa vuelva a abrirse; si termina antes, algo la cerró.
      logLine(
        texts.logFile,
        `Ventana de avance: PowerShell terminó tras ${seconds} s (código ${code}, señal ${signal})`,
      );
    });
    child.unref();
  } catch (err) {
    logLine(
      texts.logFile,
      `Ventana de avance: error al preparar la ventana: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
