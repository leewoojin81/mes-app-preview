# Windows 작업 스케줄러에 "매일 정해진 시각" 자동 업로드 작업을 등록한다.
#   .\register-task.ps1 -Time 08:30        (등록/갱신)
#   .\register-task.ps1 -Remove            (등록 해제)
param(
  [string]$Time = "08:30",
  [string]$TaskName = "MES-AutoUpload",
  [switch]$Remove
)
$ErrorActionPreference = "Stop"
if ($Remove) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false; "해제 완료: $TaskName"; exit 0 }

$script = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "auto-upload.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
# 계정 파일(DPAPI)은 등록한 사용자만 풀 수 있으므로 현재 사용자로, 로그인 상태일 때 실행한다.
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
"등록 완료: $TaskName — 매일 $Time (놓치면 켜졌을 때 즉시 실행)"
