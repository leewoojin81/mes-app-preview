# register-deploy-task.ps1 - ONE-TIME setup. Run in an ADMIN PowerShell:
#   powershell -ExecutionPolicy Bypass -File C:\Users\Administrator\Desktop\mes-system\register-deploy-task.ps1
# Registers the scheduled task "MES-Deploy-3001" (highest privileges). After this, any non-elevated
# session can deploy with:  schtasks /run /tn MES-Deploy-3001

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"C:\Users\Administrator\Desktop\mes-system\deploy-3001.ps1`""
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -AllowStartIfOnBatteries
Register-ScheduledTask -TaskName "MES-Deploy-3001" -Action $action -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "registered: MES-Deploy-3001"
