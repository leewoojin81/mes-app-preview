# 개발서버(mes-app, 3000)와 오픈서버(mes-app-preview, 3001)를 백그라운드로 실행한다.
# 이미 해당 포트가 떠 있으면 건너뛴다(중복 실행 방지).
# 로그: 각 앱 폴더의 .dev-server.out.log 에 누적 기록.

function Test-PortInUse($port) {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Start-DevServer($path, $port, $dbFile) {
    if (Test-PortInUse $port) {
        Write-Host "[$port] 이미 실행 중 - 건너뜀 ($path)"
        return
    }
    $envPrefix = if ($dbFile) { "set MES_DB_FILE=$dbFile && " } else { "" }
    $cmd = "cd /d `"$path`" && ${envPrefix}npm run dev -- -p $port >> `".dev-server.out.log`" 2>&1"
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c $cmd" -WindowStyle Hidden
    Write-Host "[$port] 시작함 ($path)$(if ($dbFile) { " [MES_DB_FILE=$dbFile]" })"
}

# mes-app(개발서버): 기본 DB(data/mes.db) 사용.
Start-DevServer "C:\Users\Administrator\Desktop\mes-system\mes-app" 3000
Start-Sleep -Seconds 3
# mes-app-preview(오픈서버): 반드시 mes-preview.db를 가리켜야 한다 — 안 그러면
# 빈 mes.db가 새로 생성되어 로그인이 전부 실패한다(2026-09-06 실제 발생·확인).
Start-DevServer "C:\Users\Administrator\Desktop\mes-system\mes-app-preview" 3001 "mes-preview.db"
