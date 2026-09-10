// 3001(mes-app-preview) DB의 데이터를 dev(mes-app) DB로 병합한다(2026-09-09 사용자 요청).
// 단순 파일 복사(overwrite)가 아니라 dev에만 있는 고유 데이터(특히 work_hours_daily
// 126건 — 사람이 직접 입력한 근태 기록)를 보존하기 위해 테이블 성격별로 다르게 처리한다:
//   - 마스터(workers/users/user_permissions): 이미 있는 키는 건드리지 않고 preview에만
//     있는 행만 추가(INSERT OR IGNORE) — dev에서 손으로 고친 값을 되돌리지 않기 위해.
//   - work_hours_daily/work_support_detail(사람이 입력): 겹치는 키는 updated_at이 더
//     최신인 쪽 값으로 남기고, 한쪽에만 있는 키는 그대로 보존.
//   - 리포트 누적 로그(dosu_change_status/defect_type_status/daily_work_status/
//     work_order_status, record_key 또는 wo_no UNIQUE): 같은 자연키는 같은 ERP 사실을
//     가리키므로 preview 값으로 덮어써도 무해 — INSERT OR REPLACE(단, id는 각 DB에서
//     독립적으로 자동증가했으므로 절대 그대로 옮기지 않고 새로 채번한다).
//   - inventory_status/process_wip_status: 자연키 자체가 없는 순수 스냅샷 교체형 테이블
//     이라 "병합"이 성립하지 않는다 — preview의 최신 스냅샷 전체로 교체한다.
// 실행 전 반드시 data/mes.db.bak-before-3001-merge-* 백업이 있는지 확인할 것.

const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");

const devPath = path.join(__dirname, "..", "data", "mes.db");
const previewPath = path.join(__dirname, "..", "..", "mes-app-preview", "data", "mes-preview.db");

const db = new DatabaseSync(devPath);
db.exec("PRAGMA foreign_keys = OFF;"); // 병합 도중 삽입 순서로 인한 일시적 FK 위반 방지, 끝나면 검증
db.exec(`ATTACH DATABASE '${previewPath.replace(/\\/g, "/")}' AS prev;`);

function run(label, sql) {
  const before = Date.now();
  const result = db.exec(sql);
  console.log(`${label}: ok (${Date.now() - before}ms)`);
  return result;
}

db.exec("BEGIN");
try {
  // 1) 마스터: 없는 것만 추가
  run(
    "workers 신규만 추가",
    `INSERT OR IGNORE INTO workers
       (employee_no, erp_code, employee_qr, worker_name, contractor, process_code, work_group,
        biz_employee_no, biz_dept, duty, team, phone, hire_date, bus_route, bus_stop, uniform_size,
        shoe_size, status, resign_date, resign_reason, remark, seq, use_yn, created_at)
     SELECT employee_no, erp_code, employee_qr, worker_name, contractor, process_code, work_group,
            biz_employee_no, biz_dept, duty, team, phone, hire_date, bus_route, bus_stop, uniform_size,
            shoe_size, status, resign_date, resign_reason, remark, seq, use_yn, created_at
     FROM prev.workers;`
  );

  run(
    "users 신규만 추가",
    `INSERT OR IGNORE INTO users
       (username, password_hash, password_salt, display_name, role, use_yn, team, employment_type, position, created_at)
     SELECT username, password_hash, password_salt, display_name, role, use_yn, team, employment_type, position, created_at
     FROM prev.users;`
  );

  run(
    "user_processes 신규만 추가",
    `INSERT OR IGNORE INTO user_processes (username, process_code)
     SELECT username, process_code FROM prev.user_processes;`
  );

  run(
    "user_permissions 신규만 추가",
    `INSERT OR IGNORE INTO user_permissions (username, screen_code, allowed)
     SELECT username, screen_code, allowed FROM prev.user_permissions;`
  );

  // 2) 사람이 입력하는 근태 데이터: 겹치는 키는 최신 updated_at이 이기고, 한쪽에만
  //    있는 키는 그대로 보존.
  run(
    "work_hours_daily upsert(최신 updated_at 우선)",
    `INSERT INTO work_hours_daily
       (work_date, employee_no, process_code, leave_type, normal_hours, overtime_hours, early_start_hours,
        lunch_shift_hours, late_hours, early_leave_hours, outing_hours, total_hours, updated_at)
     SELECT work_date, employee_no, process_code, leave_type, normal_hours, overtime_hours, early_start_hours,
            lunch_shift_hours, late_hours, early_leave_hours, outing_hours, total_hours, updated_at
     FROM prev.work_hours_daily WHERE 1=1
     ON CONFLICT(work_date, employee_no) DO UPDATE SET
       process_code=excluded.process_code, leave_type=excluded.leave_type,
       normal_hours=excluded.normal_hours, overtime_hours=excluded.overtime_hours,
       early_start_hours=excluded.early_start_hours, lunch_shift_hours=excluded.lunch_shift_hours,
       late_hours=excluded.late_hours, early_leave_hours=excluded.early_leave_hours,
       outing_hours=excluded.outing_hours, total_hours=excluded.total_hours, updated_at=excluded.updated_at
     WHERE excluded.updated_at > work_hours_daily.updated_at;`
  );

  run(
    "work_support_detail upsert(최신 updated_at 우선)",
    `INSERT INTO work_support_detail (work_date, employee_no, support_work_group, support_hours, updated_at)
     SELECT work_date, employee_no, support_work_group, support_hours, updated_at
     FROM prev.work_support_detail WHERE 1=1
     ON CONFLICT(work_date, employee_no) DO UPDATE SET
       support_work_group=excluded.support_work_group, support_hours=excluded.support_hours,
       updated_at=excluded.updated_at
     WHERE excluded.updated_at > work_support_detail.updated_at;`
  );

  // 3) ERP 리포트 누적 로그: 같은 자연키=같은 사실이라 preview 값으로 덮어써도 무해.
  //    id는 각 DB에서 독립적으로 autoincrement된 값이라 그대로 옮기면 안 되므로 컬럼
  //    목록에서 제외해 새로 채번되게 한다.
  run(
    "dosu_change_status upsert(record_key)",
    `INSERT INTO dosu_change_status (record_key, order_date, inspect_date, item_code, wo_no, lot_no, uploaded_at, detail)
     SELECT record_key, order_date, inspect_date, item_code, wo_no, lot_no, uploaded_at, detail FROM prev.dosu_change_status
     WHERE record_key IS NOT NULL
     ON CONFLICT(record_key) DO UPDATE SET
       order_date=excluded.order_date, inspect_date=excluded.inspect_date, item_code=excluded.item_code,
       wo_no=excluded.wo_no, lot_no=excluded.lot_no, uploaded_at=excluded.uploaded_at, detail=excluded.detail;`
  );

  run(
    "defect_type_status upsert(record_key)",
    `INSERT INTO defect_type_status (record_key, order_date, item_code, wo_no, lot_no, uploaded_at, detail)
     SELECT record_key, order_date, item_code, wo_no, lot_no, uploaded_at, detail FROM prev.defect_type_status
     WHERE record_key IS NOT NULL
     ON CONFLICT(record_key) DO UPDATE SET
       order_date=excluded.order_date, item_code=excluded.item_code, wo_no=excluded.wo_no,
       lot_no=excluded.lot_no, uploaded_at=excluded.uploaded_at, detail=excluded.detail;`
  );

  run(
    "daily_work_status upsert(record_key)",
    `INSERT INTO daily_work_status (record_key, work_date, item_code, process_code, wo_no, lot_no, uploaded_at, detail)
     SELECT record_key, work_date, item_code, process_code, wo_no, lot_no, uploaded_at, detail FROM prev.daily_work_status
     WHERE record_key IS NOT NULL
     ON CONFLICT(record_key) DO UPDATE SET
       work_date=excluded.work_date, item_code=excluded.item_code, process_code=excluded.process_code,
       wo_no=excluded.wo_no, lot_no=excluded.lot_no, uploaded_at=excluded.uploaded_at, detail=excluded.detail;`
  );

  run(
    "work_order_status upsert(wo_no)",
    `INSERT INTO work_order_status (wo_no, order_date, item_code, lot_no, so_no, uploaded_at, detail)
     SELECT wo_no, order_date, item_code, lot_no, so_no, uploaded_at, detail FROM prev.work_order_status
     WHERE wo_no IS NOT NULL
     ON CONFLICT(wo_no) DO UPDATE SET
       order_date=excluded.order_date, item_code=excluded.item_code, lot_no=excluded.lot_no,
       so_no=excluded.so_no, uploaded_at=excluded.uploaded_at, detail=excluded.detail;`
  );

  // 4) 자연키가 아예 없는 순수 스냅샷 교체형 — "병합"이 성립하지 않아 preview의 최신
  //    스냅샷 전체로 통째로 교체한다(공정재공현황/현재고현황 기존 재업로드 방식과 동일).
  run("inventory_status 전체 교체", "DELETE FROM inventory_status;");
  run(
    "inventory_status preview 스냅샷 적재",
    `INSERT INTO inventory_status (item_code, lot_no, warehouse, stock_qty, uploaded_at, detail)
     SELECT item_code, lot_no, warehouse, stock_qty, uploaded_at, detail FROM prev.inventory_status;`
  );

  run("process_wip_status 전체 교체", "DELETE FROM process_wip_status;");
  run(
    "process_wip_status preview 스냅샷 적재",
    `INSERT INTO process_wip_status (item_code, wo_no, lot_no, so_no, uploaded_at, detail)
     SELECT item_code, wo_no, lot_no, so_no, uploaded_at, detail FROM prev.process_wip_status;`
  );

  db.exec("COMMIT");
  console.log("COMMIT ok");
} catch (err) {
  db.exec("ROLLBACK");
  console.error("ROLLBACK — 에러 발생:", err);
  process.exit(1);
}

db.exec("PRAGMA foreign_keys = ON;");
// 병합 후 FK 무결성 검증 — 위반이 있으면 즉시 알 수 있게.
const violations = db.prepare("PRAGMA foreign_key_check;").all();
if (violations.length > 0) {
  console.error("FK 위반 발견:", violations);
  process.exit(1);
}
console.log("FK 무결성 검증 통과");
db.exec("DETACH DATABASE prev;");
