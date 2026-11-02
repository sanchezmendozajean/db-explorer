import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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

/** Abre la ventana de avance de la actualización (solo Windows); los errores no impiden instalar. */
export function showUpdateProgress(texts: { title: string; message: string }): void {
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
    child.unref();
  } catch {
    // Sin ventana de avance la instalación sigue igual.
  }
}
