# 개발서버(mes-app) -> 오픈서버(mes-app-preview, 3001번) 코드 동기화 스크립트.
# 2026-09-04 신설 — 이전엔 사용자가 robocopy 명령을 세션마다 손으로 직접 입력했는데,
# 앞으로는 항상 이 스크립트로만 동기화한다(수동 robocopy 입력 금지).
#
# 복사 대상: mes-app 소스 전체(src, public, scripts, package.json, next.config.ts 등
#            "코드/설정" 성격의 파일 — node_modules/.next/.git/data 4개만 제외).
# 복사하지 않는(항상 제외) 대상:
#   node_modules - mes-app 것을 정션(mklink /J)으로 공유하므로 복사 대상 아님
#   .next        - 인스턴스별 빌드 캐시(공유하면 두 dev 서버가 충돌함)
#   data         - 미리보기 전용 DB(data\mes-preview.db)가 들어있어 절대 덮어쓰면 안 됨
#   .git         - mes-app-preview는 별도 저장소가 아니므로 불필요
#
# 안전장치: 실행 전 mes-preview.db의 크기/마지막 수정시각을 보여주고 y/N 확인을 받은
# 뒤에만 복사하며, 복사가 끝나면 같은 값을 다시 보여줘 데이터가 그대로인지 눈으로
# 대조할 수 있게 한다(크기·수정시각이 하나라도 달라지면 경고를 띄운다 — data 폴더는
# robocopy가 손대지 않으므로 원래는 항상 동일해야 정상이다. 값이 바뀌었다면 이 스크립트
# 때문이 아니라 그 사이 실제 3001번 서버가 켜져 있어 DB에 뭔가 쓴 것일 가능성이 높다).
#
# 사용법:
#   powershell -File scripts\sync-to-preview.ps1          # 대화형 확인 후 실행
#   powershell -File scripts\sync-to-preview.ps1 -Yes     # 확인 없이 바로 실행(자동화용)
#
# 실행 후 안내: 소스 코드만 반영되고 DB 스키마 변경은 별도다 — workers 컬럼 추가처럼
# 기존 테이블 구조가 바뀌었다면 mes-preview.db에도 같은 스키마 변경을 따로 적용해야
# 한다(재시작만으로는 기존 테이블 컬럼이 안 바뀜, mes-app-structure 메모리 참고).

param(
    [switch]$Yes
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot   # mes-app
$mesSystemRoot = Split-Path -Parent $repoRoot  # mes-system
$src = $repoRoot
$dst = Join-Path $mesSystemRoot "mes-app-preview"
$previewDb = Join-Path $dst "data\mes-preview.db"

Write-Host "=== 개발서버(mes-app) -> 오픈서버(mes-app-preview) 코드 동기화 ===" -ForegroundColor Cyan
Write-Host "원본: $src"
Write-Host "대상: $dst"
Write-Host "제외(절대 안 건드림): node_modules, .next, .git, data\ (mes-preview.db 포함)" -ForegroundColor Yellow
Write-Host ""

function Get-DbSnapshot($path) {
    if (Test-Path $path) {
        $item = Get-Item $path
        return [PSCustomObject]@{ Exists = $true; Length = $item.Length; LastWriteTime = $item.LastWriteTime }
    }
    return [PSCustomObject]@{ Exists = $false; Length = -1; LastWriteTime = $null }
}

$before = Get-DbSnapshot $previewDb
if ($before.Exists) {
    Write-Host "[복사 전] mes-preview.db 크기: $($before.Length) bytes / 마지막 수정: $($before.LastWriteTime)"
} else {
    Write-Host "[복사 전] mes-preview.db 파일이 없습니다." -ForegroundColor Yellow
}
Write-Host ""

if (-not $Yes) {
    $answer = Read-Host "정말 진행하시겠습니까? 코드만 복사되고 data 폴더(DB)는 건드리지 않습니다 [y/N]"
    if ($answer -ne "y" -and $answer -ne "Y") {
        Write-Host "취소되었습니다." -ForegroundColor Yellow
        exit 0
    }
}

robocopy $src $dst /E /XD node_modules .next data .git /XF tsconfig.tsbuildinfo .dev-server.out.log /NFL /NDL /NJH /NJS
$robocopyExit = $LASTEXITCODE
# robocopy는 파일을 하나라도 복사하면 exit code 1을 반환한다(정상). 8 이상만 실제 오류.
if ($robocopyExit -ge 8) {
    Write-Error "robocopy 실패 (exit code $robocopyExit)"
    exit 1
}

$nodeModulesLink = Join-Path $dst "node_modules"
if (-not (Test-Path $nodeModulesLink)) {
    cmd /c mklink /J "$nodeModulesLink" "$src\node_modules" | Out-Null
    Write-Host "node_modules 정션을 새로 만들었습니다."
}

Write-Host ""
$after = Get-DbSnapshot $previewDb
if ($after.Exists) {
    Write-Host "[복사 후] mes-preview.db 크기: $($after.Length) bytes / 마지막 수정: $($after.LastWriteTime)"
} else {
    Write-Host "[복사 후] mes-preview.db 파일이 여전히 없습니다." -ForegroundColor Yellow
}

if ($before.Exists -and $after.Exists -and ($before.Length -ne $after.Length -or $before.LastWriteTime -ne $after.LastWriteTime)) {
    Write-Warning "mes-preview.db가 복사 전후로 달라졌습니다! 이 스크립트는 data 폴더를 건드리지 않으니, 동기화 중 3001번 서버(또는 다른 프로세스)가 DB에 실제로 쓰기 작업을 했을 가능성이 있습니다. 확인해 주세요."
} elseif ($before.Exists -ne $after.Exists) {
    Write-Warning "mes-preview.db의 존재 여부가 복사 전후로 달라졌습니다. 확인해 주세요."
} else {
    Write-Host "mes-preview.db는 복사 전후 동일합니다 (정상)." -ForegroundColor Green
}

Write-Host ""
Write-Host "동기화 완료. DB 스키마를 바꿨다면(테이블/컬럼 추가 등) mes-preview.db에도 별도로 반영이 필요합니다 — next.config.ts 등 설정이 바뀐 경우 3001번 서버 재시작도 권장합니다." -ForegroundColor Cyan
