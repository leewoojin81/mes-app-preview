# 3000(mes-app, 개발서버) DB를 3001(mes-app-preview, 미리보기서버) DB로 매일 새벽 통째로
# 덮어써 동기화한다(2026-09-10 사용자 요청 — Windows 작업 스케줄러로 매일 02:00 자동 실행,
# 작업 이름 "MES-DB-야간동기화"). 3001은 이제 3000의 최신 상태를 그대로 보여주는 미리보기
# 전용이라, 3001에만 그날 따로 입력된 값이 있어도 이 동기화로 전부 없어진다(사용자 확인 —
# 반대 방향인 merge-preview-into-dev.js가 양쪽 고유 데이터를 보존하는 것과 달리, 이번엔
# 통째 덮어쓰기로 결정함).
#
# 절차:
#   1. 안전 백업 — 지금 mes-preview.db를 backups\ 아래 타임스탬프 이름으로 먼저 복사해둔다
#      (교체 실패/사고 대비. 최근 것만 있으면 되므로 7일 지난 건 이 스크립트가 자체 정리).
#   2. 3001 서버(포트 3001) 프로세스를 찾아 종료 — 파일이 열려 있으면 교체가 실패하거나
#      떠 있는 서버가 옛 파일 핸들을 계속 참조해 꼬일 수 있다.
#   3. mes.db(3000)를 SQLite "VACUUM INTO"(scripts\vacuum-into.js)로 mes-preview.db에 새로
#      생성 — 단순 파일 복사(Copy-Item)와 달리 3000이 그 순간 쓰기 중이어도 항상 트랜잭션
#      일관성 있는 스냅샷이 보장되어, 3000 서버는 멈출 필요가 없다.
#   4. 3001 서버를 다시 기동(start-servers.ps1과 동일한 실행 방식).
#
# 로그: mes-system\logs\db-sync-to-preview.log 에 누적 기록.
#
# 수동 실행: powershell -File scripts\sync-dev-db-to-preview.ps1
# 자동 실행: Windows 작업 스케줄러 "MES-DB-야간동기화"(매일 02:00, Run As Administrator).

$ErrorActionPreference = "Stop"

$mesSystemRoot = "C:\Users\Administrator\Desktop\mes-system"
$devRoot = Join-Path $mesSystemRoot "mes-app"
$previewRoot = Join-Path $mesSystemRoot "mes-app-preview"
$devDb = Join-Path $devRoot "data\mes.db"
$previewDb = Join-Path $previewRoot "data\mes-preview.db"
$backupDir = Join-Path $mesSystemRoot "backups"
$logDir = Join-Path $mesSystemRoot "logs"
$logFile = Join-Path $logDir "db-sync-to-preview.log"
$vacuumScript = Join-Path $devRoot "scripts\vacuum-into.js"

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

function Test-PortInUse($port) {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

Log "=== 3000 -> 3001 DB 동기화 시작 ==="

try {
    if (-not (Test-Path $devDb)) {
        throw "원본 DB를 찾을 수 없습니다: $devDb"
    }

    # 1) 안전 백업(최근 것만 있으면 되므로 7일 지난 건 정리 — backups\ 폴더의
    #    backup-preview-db.ps1 정기백업과는 별개 파일명이라 서로 안 건드림)
    if (Test-Path $previewDb) {
        if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
        $stamp = Get-Date -Format "yyyyMMddHHmmss"
        $backupPath = Join-Path $backupDir "mes-preview_before_sync_$stamp.db"
        Copy-Item -Path $previewDb -Destination $backupPath -Force
        Log "백업 완료: $backupPath"
        Get-ChildItem $backupDir -Filter "mes-preview_before_sync_*.db" -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
            ForEach-Object {
                Remove-Item $_.FullName -Force
                Log "오래된 백업 삭제: $($_.Name)"
            }
    } else {
        Log "기존 mes-preview.db가 없어 백업을 건너뜁니다."
    }

    # 2) 3001 서버 종료(파일 핸들 해제 — 안 그러면 VACUUM INTO 대상 파일 삭제/생성이
    #    막히거나, 떠 있는 서버가 교체된 파일을 인식 못 하고 옛 핸들만 계속 씀)
    $conns = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($procId in $pids) {
            Log "3001 서버 프로세스 종료 (PID $procId)"
            try { taskkill /F /T /PID $procId | Out-Null } catch { Log "종료 중 경고: $_" }
        }
        Start-Sleep -Seconds 2
    } else {
        Log "3001 서버가 이미 꺼져 있습니다."
    }

    # 3) VACUUM INTO로 안전하게 새 mes-preview.db 생성(대상 파일이 이미 있으면 SQLite가
    #    에러를 내므로 먼저 지운다 — 위에서 이미 백업을 떴으니 안전함)
    if (Test-Path $previewDb) { Remove-Item $previewDb -Force }
    & node $vacuumScript $devDb $previewDb
    if ($LASTEXITCODE -ne 0) { throw "VACUUM INTO 실패 (exit $LASTEXITCODE)" }
    Log "mes.db -> mes-preview.db 스냅샷 복사 완료"

    # 4) 3001 서버 재기동(start-servers.ps1의 Start-DevServer와 동일한 실행 방식)
    $cmd = "cd /d `"$previewRoot`" && set MES_DB_FILE=mes-preview.db && npm run dev -- -p 3001 >> `".dev-server.out.log`" 2>&1"
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c $cmd" -WindowStyle Hidden
    Log "3001 서버 재기동함"

    Log "=== 동기화 성공 ==="
} catch {
    Log "!!! 동기화 실패: $_"
    throw
}
