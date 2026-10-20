# register-backup-task.ps1 - ONE-TIME setup. Run in an ADMIN PowerShell:
#   powershell -ExecutionPolicy Bypass -File C:\Users\Administrator\Desktop\mes-system\register-backup-task.ps1
# Registers the scheduled task "MES-DB-Backup": every day 03:00 runs backup-db.ps1 (3000/3001 DB, keep 14 days).

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"C:\Users\Administrator\Desktop\mes-system\backup-db.ps1`""
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName "MES-DB-Backup" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "registered: MES-DB-Backup (daily 03:00)"
