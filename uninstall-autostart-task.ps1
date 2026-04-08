param(
  [string]$TaskName = "PaperclipDevAutoStart",
  [string]$RunEntryName = "PaperclipDevAutoStart"
)

$ErrorActionPreference = "SilentlyContinue"

$existing = Get-ScheduledTask -TaskName $TaskName
if ($existing) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "Scheduled task removed: $TaskName"
} else {
  Write-Output "Scheduled task not found: $TaskName"
}

$runPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$entry = Get-ItemProperty -Path $runPath -Name $RunEntryName -ErrorAction SilentlyContinue
if ($entry) {
  Remove-ItemProperty -Path $runPath -Name $RunEntryName -ErrorAction SilentlyContinue
  Write-Output "HKCU Run entry removed: $RunEntryName"
}
