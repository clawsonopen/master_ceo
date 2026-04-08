param(
  [string]$Workspace = "C:\Users\ozany\Documents\MASTER CEO\paperclip",
  [int]$Port = 3100
)

$ErrorActionPreference = "Continue"

function Get-ManagedRuntimePaths {
  $root = "C:\Users\ozany\Documents\MASTER CEO\.runtime\paperclip-dev"
  [pscustomobject]@{
    Root = $root
    PidFile = Join-Path $root "dev.pid"
    MetaFile = Join-Path $root "meta.json"
  }
}

function Stop-ById([int]$TargetId) {
  try {
    Stop-Process -Id $TargetId -Force -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

$runtime = Get-ManagedRuntimePaths
$stopped = @()
$found = @()
$failed = @()

if (Test-Path $runtime.PidFile) {
  $pidRaw = Get-Content $runtime.PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
  [int]$managedPid = 0
  if ([int]::TryParse($pidRaw, [ref]$managedPid)) {
    $found += $managedPid
    if (Stop-ById -TargetId $managedPid) {
      $stopped += $managedPid
    } else {
      $failed += $managedPid
    }
  }
}

Get-CimInstance Win32_Process |
  Where-Object {
    ($_.Name -in @("node.exe", "pnpm.exe", "pnpm.cmd", "tsx.exe")) -and
    ($_.CommandLine -like "*$Workspace*")
  } |
  ForEach-Object {
    $found += $_.ProcessId
    if (Stop-ById -TargetId $_.ProcessId) {
      $stopped += $_.ProcessId
    } else {
      $failed += $_.ProcessId
    }
  }

# Stop embedded-postgres processes tied to default Paperclip data dir.
Get-CimInstance Win32_Process |
  Where-Object {
    ($_.Name -match "postgres|postmaster") -or
    ($_.CommandLine -match "\\.paperclip\\instances\\default\\db")
  } |
  ForEach-Object {
    $found += $_.ProcessId
    if (Stop-ById -TargetId $_.ProcessId) {
      $stopped += $_.ProcessId
    } else {
      $failed += $_.ProcessId
    }
  }

# Safety net: kill any remaining postgres.exe processes (embedded postgres workers).
Get-Process -Name "postgres" -ErrorAction SilentlyContinue | ForEach-Object {
  $found += $_.Id
  if (Stop-ById -TargetId $_.Id) {
    $stopped += $_.Id
  } else {
    $failed += $_.Id
  }
}

# Prefer killing listener first so detached/foreign session runners also stop.
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  foreach ($row in $listener) {
    $targetId = [int]$row.OwningProcess
    $found += $targetId
    if (Stop-ById -TargetId $targetId) {
      $stopped += $targetId
    } else {
      $failed += $targetId
    }
  }
}

# Also clear embedded postgres listener ports commonly used by this workspace.
foreach ($pgPort in @(54329, 54330)) {
  $pgListener = Get-NetTCPConnection -LocalPort $pgPort -State Listen -ErrorAction SilentlyContinue
  if ($pgListener) {
    foreach ($row in $pgListener) {
      $targetId = [int]$row.OwningProcess
      $found += $targetId
      if (Stop-ById -TargetId $targetId) {
        $stopped += $targetId
      } else {
        $failed += $targetId
      }
    }
  }
}

if (Test-Path $runtime.PidFile) { Remove-Item -Force $runtime.PidFile }
if (Test-Path $runtime.MetaFile) { Remove-Item -Force $runtime.MetaFile }

$uniqueFound = @($found | Sort-Object -Unique)
$uniqueStopped = @($stopped | Sort-Object -Unique)
$uniqueFailed = @($failed | Sort-Object -Unique)

if ($uniqueFound.Count -eq 0) {
  Write-Output "No running Paperclip dev process found."
} else {
  if ($uniqueStopped.Count -gt 0) {
    Write-Output "Stopped Paperclip dev processes: $($uniqueStopped -join ', ')"
  }
  if ($uniqueFailed.Count -gt 0) {
    Write-Output "Could not stop processes (permission/session mismatch): $($uniqueFailed -join ', ')"
  }
}
