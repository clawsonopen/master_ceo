param(
  [string]$TaskName = "PaperclipDevAutoStart",
  [string]$RootPath = "C:\Users\ozany\Documents\MASTER CEO",
  [string]$RunEntryName = "PaperclipDevAutoStart"
)

$ErrorActionPreference = "Stop"

$startScript = Join-Path $RootPath "start-dev.ps1"
if (!(Test-Path $startScript)) {
  throw "Missing start script: $startScript"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

try {
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null

  Write-Output "Scheduled task installed: $TaskName"
  Write-Output "Trigger: At logon ($env:USERNAME)"
  Write-Output "Action: powershell.exe -File `"$startScript`""
} catch {
  $runPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
  $cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$startScript`""
  New-Item -Path $runPath -Force | Out-Null
  Set-ItemProperty -Path $runPath -Name $RunEntryName -Value $cmd
  Write-Output "Scheduled task install failed; fallback installed to HKCU Run."
  Write-Output "Run entry: $RunEntryName"
  Write-Output "Command: $cmd"
}
