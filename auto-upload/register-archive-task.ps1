# Windows 작업 스케줄러에 "매일 아침 업로드자료 정리(archive-old.ps1)" 작업을 등록한다.
#   .\register-archive-task.ps1 -Time 07:00   (등록/갱신, 관리자 PowerShell에서 실행)
#   .\register-archive-task.ps1 -Remove       (등록 해제)
param(
  [string]$Time = "07:00",
  [string]$TaskName = "MES-Archive-Upload",
  [switch]$Remove
)
$ErrorActionPreference = "Stop"
if ($Remove) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false; "해제 완료: $TaskName"; exit 0 }

$script = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "archive-old.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force -ErrorAction Stop | Out-Null
"등록 완료: $TaskName — 매일 $Time (놓치면 켜졌을 때 즉시 실행)"
