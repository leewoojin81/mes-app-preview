# deploy-3001.ps1 - build mes-app-preview and restart the 3001 (open) server.
# Run via the scheduled task "MES-Deploy-3001" (registered once as admin, see register-deploy-task.ps1),
# so it can be triggered without elevation:  schtasks /run /tn MES-Deploy-3001
# Log: deploy-3001.log (same folder). ASCII only on purpose (Windows PowerShell 5.1 + no BOM).

$ErrorActionPreference = "Stop"
$root = "C:\Users\Administrator\Desktop\mes-system"
$app = Join-Path $root "mes-app-preview"
$log = Join-Path $root "deploy-3001.log"

function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" | Out-File -FilePath $log -Append -Encoding utf8 }

try {
    Log "=== deploy start ==="
    Set-Location $app

    # menus marked devOnly in nav-groups.ts (e.g. PROC in progress) are left out of the 3001 build
    $env:NEXT_PUBLIC_MES_SERVER = "preview"

    # 1) build first (old server keeps serving meanwhile)
    Log "next build ..."
    $build = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx next build --webpack >> `"$log`" 2>&1" -WorkingDirectory $app -Wait -PassThru -WindowStyle Hidden
    if ($build.ExitCode -ne 0) { throw "build failed (exit $($build.ExitCode)) - 3001 left running with the old build" }

    # 2) stop whatever listens on 3001 (whole tree)
    $conn = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $pid3001 = $conn.OwningProcess | Select-Object -First 1
        Log "stopping 3001 (pid $pid3001)"
        taskkill /PID $pid3001 /F /T | Out-Null
        Start-Sleep -Seconds 3
    }

    # 3) start again with the preview DB (without MES_DB_FILE it would open an empty mes.db)
    $cmd = "cd /d `"$app`" && set MES_DB_FILE=mes-preview.db && npm run start -- -p 3001 >> `".dev-server.out.log`" 2>&1"
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c $cmd" -WindowStyle Hidden

    # 4) health check
    $ok = $false
    for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
        Start-Sleep -Seconds 2
        try { $ok = (Invoke-WebRequest "http://localhost:3001/login" -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200 } catch { }
    }
    if (-not $ok) { throw "3001 did not come up within 40s" }
    Log "=== deploy OK ==="
}
catch {
    Log "=== deploy FAILED: $($_.Exception.Message) ==="
    exit 1
}
