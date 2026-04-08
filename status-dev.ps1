param(
  [string]$Workspace = "C:\Users\ozany\Documents\MASTER CEO\paperclip",
  [int]$Port = 3100
)

$runtimeRoot = "C:\Users\ozany\Documents\MASTER CEO\.runtime\paperclip-dev"
$outLog = Join-Path $runtimeRoot "dev-out.log"
$errLog = Join-Path $runtimeRoot "dev-err.log"
$pidFile = Join-Path $runtimeRoot "dev.pid"
$metaFile = Join-Path $runtimeRoot "meta.json"

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  Write-Output "Port $Port listening (PID=$($listener.OwningProcess))."
} else {
  Write-Output "Port $Port not listening."
}

$procs = Get-CimInstance Win32_Process |
  Where-Object {
    ($_.Name -in @("node.exe", "pnpm.exe", "pnpm.cmd", "tsx.exe")) -and
    ($_.CommandLine -like "*$Workspace*")
  } |
  Select-Object ProcessId, Name

if ($procs) {
  Write-Output "Paperclip-related processes:"
  $procs | Format-Table -AutoSize | Out-String | Write-Output
} else {
  Write-Output "No Paperclip-related process found for workspace."
}

if (Test-Path $pidFile) {
  Write-Output "Managed PID file: $pidFile = $(Get-Content $pidFile | Select-Object -First 1)"
} else {
  Write-Output "Managed PID file not found."
}

if (Test-Path $metaFile) {
  Write-Output "Meta: $metaFile"
  Get-Content $metaFile | Write-Output
}

if (Test-Path $outLog) {
  Write-Output "--- dev-out tail ---"
  Get-Content $outLog -Tail 30 | Write-Output
}

if (Test-Path $errLog) {
  Write-Output "--- dev-err tail ---"
  Get-Content $errLog -Tail 30 | Write-Output
}
