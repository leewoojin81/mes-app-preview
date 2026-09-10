# mes-preview.db(오픈서버 DB) 정기 백업 스크립트.
# 2026-09-04 신설 — 사용자 요청으로 작성.
#
# 하는 일:
#   1. mes-app-preview\data\mes-preview.db 를 mes-system\backups\ (mes-app-preview 밖의
#      별도 폴더 — 원본이 통째로 삭제되는 사고와 백업이 같이 날아가지 않도록) 아래에
#      mes-preview_YYYYMMDD.db 이름으로 복사한다.
#   2. 복사 후 원본/백업 파일 크기를 비교해 다르면 경고를 띄운다(복사 도중 DB가
#      쓰기 중이었을 가능성 — SQLite가 rollback journal 모드라 대개는 안전하지만,
#      정확히 트랜잭션 커밋 중간 순간과 겹치면 이론상 있을 수 있음).
#   3. 보관 기간(-RetentionDays, 기본 30일)보다 오래된 백업 파일을 자동 삭제한다.
#
# 사용법:
#   수동 실행:      powershell -File scripts\backup-preview-db.ps1
#   보관 기간 변경:  powershell -File scripts\backup-preview-db.ps1 -RetentionDays 60
#
# 자동 실행(Windows 작업 스케줄러)은 이 파일 맨 아래 주석 또는 저장소 문서를 참고할 것
# — 매일 같은 시각에 이 스크립트가 자동으로 돌게 등록할 수 있다.

param(
    [int]$RetentionDays = 30
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot   # mes-app
$mesSystemRoot = Split-Path -Parent $repoRoot  # mes-system
$srcDb = Join-Path $mesSystemRoot "mes-app-preview\data\mes-preview.db"
$backupDir = Join-Path $mesSystemRoot "backups"

Write-Host "=== mes-preview.db 백업 ===" -ForegroundColor Cyan

if (-not (Test-Path $srcDb)) {
    Write-Error "원본 DB를 찾을 수 없습니다: $srcDb"
    exit 1
}

if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
    Write-Host "백업 폴더를 새로 만들었습니다: $backupDir"
}

$srcItem = Get-Item $srcDb
Write-Host "원본: $srcDb"
Write-Host "  크기: $('{0:N0}' -f $srcItem.Length) bytes / 마지막 수정: $($srcItem.LastWriteTime)"

# 디스크 여유 공간 확인 — mes-preview.db가 GB 단위로 커서(현재 약 1.3GB) 매일 백업 +
# 장기 보관을 계속하면 디스크가 꽉 찰 수 있다(2026-09-04 확인 시점: 여유 18.2GB, 30일
# 보관이면 약 39GB 필요 — 사용자가 위험을 인지하고도 30일 유지를 선택함). 그래도 실제로
# 공간이 바닥나 "복사가 중간에 잘린 손상된 백업 파일"이 남는 사고는 막아야 하므로,
# 원본 크기만큼도 없으면 아예 중단하고, 넉넉하지 않으면(2배 미만) 경고만 띄운다.
$driveLetter = (Get-Item $backupDir).PSDrive.Name
$freeBytes = (Get-PSDrive $driveLetter).Free
if ($freeBytes -lt $srcItem.Length) {
    Write-Error "디스크 여유 공간($('{0:N1}' -f ($freeBytes / 1GB)) GB)이 원본 DB 크기보다 작습니다 - 백업을 중단합니다. 공간을 확보하거나 -RetentionDays를 줄여서 오래된 백업을 먼저 정리하세요."
    exit 1
} elseif ($freeBytes -lt ($srcItem.Length * 2)) {
    Write-Warning "디스크 여유 공간이 넉넉하지 않습니다(여유 $('{0:N1}' -f ($freeBytes / 1GB)) GB, 원본 $('{0:N1}' -f ($srcItem.Length / 1GB)) GB) - 조만간 -RetentionDays를 줄이거나 디스크 공간을 확보해야 할 수 있습니다."
}

$stamp = Get-Date -Format "yyyyMMdd"
$backupPath = Join-Path $backupDir "mes-preview_$stamp.db"

Copy-Item -Path $srcDb -Destination $backupPath -Force

$backupItem = Get-Item $backupPath
Write-Host "백업: $backupPath"
Write-Host "  크기: $('{0:N0}' -f $backupItem.Length) bytes"

if ($backupItem.Length -ne $srcItem.Length) {
    Write-Warning "백업 파일 크기가 원본과 다릅니다 (원본 $($srcItem.Length) / 백업 $($backupItem.Length)) - 복사 도중 DB에 쓰기가 있었을 수 있습니다. 필요하면 다시 실행해 재백업하세요."
} else {
    Write-Host "백업 완료 (원본과 크기 동일, 정상)." -ForegroundColor Green
}

# 보관 기간보다 오래된 백업 삭제 — 파일명의 날짜가 아니라 실제 파일 수정시각 기준.
$cutoff = (Get-Date).AddDays(-$RetentionDays)
$old = Get-ChildItem -Path $backupDir -Filter "mes-preview_*.db" |
    Where-Object { $_.LastWriteTime -lt $cutoff }

if ($old.Count -gt 0) {
    Write-Host ""
    Write-Host "보관 기간(${RetentionDays}일)을 넘은 백업 $($old.Count)개 삭제:" -ForegroundColor Yellow
    foreach ($f in $old) {
        Remove-Item $f.FullName -Force
        Write-Host "  - $($f.Name)"
    }
}

$remaining = Get-ChildItem -Path $backupDir -Filter "mes-preview_*.db"
Write-Host ""
Write-Host "완료. 현재 보관 중인 백업: $($remaining.Count)개, 총 $('{0:N1}' -f (($remaining | Measure-Object Length -Sum).Sum / 1GB)) GB" -ForegroundColor Cyan

# --- Windows 작업 스케줄러 자동 등록 예시 (관리자 권한 PowerShell에서 한 번만 실행) ---
# $action    = New-ScheduledTaskAction -Execute "powershell.exe" `
#                -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\Users\Administrator\Desktop\mes-system\mes-app\scripts\backup-preview-db.ps1"'
# $trigger   = New-ScheduledTaskTrigger -Daily -At 3am
# $settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd
# Register-ScheduledTask -TaskName "MES-PreviewDB-Backup" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest
