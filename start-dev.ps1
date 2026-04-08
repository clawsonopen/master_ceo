param(
  [string]$Workspace = "C:\Users\ozany\Documents\MASTER CEO\paperclip",
  [int]$Port = 3100
)

$ErrorActionPreference = "Stop"

function Get-ManagedRuntimePaths {
  $root = "C:\Users\ozany\Documents\MASTER CEO\.runtime\paperclip-dev"
  [pscustomobject]@{
    Root = $root
    PidFile = Join-Path $root "dev.pid"
    OutLog = Join-Path $root "dev-out.log"
    ErrLog = Join-Path $root "dev-err.log"
    MetaFile = Join-Path $root "meta.json"
  }
}

function Get-ListenerPid([int]$CheckPort) {
  $listener = Get-NetTCPConnection -LocalPort $CheckPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) { return [int]$listener.OwningProcess }
  return $null
}

function Get-PaperclipProcessByWorkspace([string]$TargetWorkspace) {
  Get-CimInstance Win32_Process |
    Where-Object {
      ($_.Name -in @("node.exe", "pnpm.exe", "pnpm.cmd", "tsx.exe")) -and
      ($_.CommandLine -like "*$TargetWorkspace*")
    } |
    Select-Object -First 1
}

$runtime = Get-ManagedRuntimePaths
New-Item -ItemType Directory -Force -Path $runtime.Root | Out-Null

$existingListenerPid = Get-ListenerPid -CheckPort $Port
if ($existingListenerPid) {
  Write-Output "Paperclip already listening on $Port (PID=$existingListenerPid). No action taken."
  exit 0
}

$existingProc = Get-PaperclipProcessByWorkspace -TargetWorkspace $Workspace
if ($existingProc) {
  Write-Output "Paperclip process already running (PID=$($existingProc.ProcessId)) but port $Port is not listening yet."
  Write-Output "Wait a few seconds and run status-dev.ps1."
  exit 0
}

if (Test-Path $runtime.OutLog) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  Move-Item -Force $runtime.OutLog (Join-Path $runtime.Root "dev-out-$stamp.log")
}
if (Test-Path $runtime.ErrLog) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  Move-Item -Force $runtime.ErrLog (Join-Path $runtime.Root "dev-err-$stamp.log")
}

$proc = Start-Process -FilePath "pnpm.cmd" `
  -ArgumentList "dev" `
  -WorkingDirectory $Workspace `
  -WindowStyle Hidden `
  -RedirectStandardOutput $runtime.OutLog `
  -RedirectStandardError $runtime.ErrLog `
  -PassThru
 
$deadline = (Get-Date).AddSeconds(90)
$listenerPid = $null
while ((Get-Date) -lt $deadline) {
  $listenerPid = Get-ListenerPid -CheckPort $Port
  if ($listenerPid) { break }
  if ($proc.HasExited) { break }
  Start-Sleep -Seconds 2
}

if ($listenerPid) {
  $managedPid = $listenerPid
  $meta = @{
    startedAt = (Get-Date).ToString("o")
    workspace = $Workspace
    port = $Port
    pid = $managedPid
    launcherPid = $proc.Id
  }
  $meta | ConvertTo-Json | Set-Content -Path $runtime.MetaFile -Encoding UTF8
  Set-Content -Path $runtime.PidFile -Value "$managedPid" -Encoding ASCII
  Write-Output "Paperclip started successfully on http://127.0.0.1:$Port (PID=$listenerPid)."
  Write-Output "Logs:"
  Write-Output "  $($runtime.OutLog)"
  Write-Output "  $($runtime.ErrLog)"
  exit 0
}

if ($proc.HasExited) {
  Write-Output "Paperclip launcher exited early with code $($proc.ExitCode)."
} else {
  Write-Output "Paperclip launcher is running (PID=$($proc.Id)) but port $Port is not listening yet."
}
Write-Output "Check logs:"
Write-Output "  $($runtime.OutLog)"
Write-Output "  $($runtime.ErrLog)"
exit 1
