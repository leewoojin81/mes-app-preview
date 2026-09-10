// 2026-09-04 일회성: C:\Users\Administrator\Desktop\mes-system\작업자등록.xlsx (현장 인사
// 원본 대장, 헤더가 2번째 행에 있고 "공정" 컬럼은 이름표 없이 8번째 열에 있음)를
// workers 테이블로 적재한다. src/app/api/workers/import/route.ts(재사용 가능한 화면
// 업로드 기능)는 이 원본의 특수한 레이아웃(헤더 위치, 이름 없는 소속 컬럼)을 처리하지
// 않으므로 별도 스크립트로 처리한다.
const { DatabaseSync } = require("node:sqlite");
const XLSX = require("xlsx");
const path = require("path");

const SRC = "C:/Users/Administrator/Desktop/mes-system/작업자등록.xlsx";
const DB = path.join(__dirname, "..", "data", "mes.db");

function dateOrNull(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const utcMs = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(utcMs);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return s || null;
}
function strOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

const wb = XLSX.readFile(SRC);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

// 실측: rows[1]이 헤더, rows[3]부터 데이터.
const header = rows[1].map((h) => (h == null ? "" : String(h).trim()));
if (header[2] !== "사번" || header[6] !== "성명") {
  throw new Error(`예상한 헤더 위치가 아닙니다: ${JSON.stringify(header)}`);
}

const db = new DatabaseSync(DB);
const upsert = db.prepare(
  `INSERT INTO workers
     (employee_no, erp_code, employee_qr, worker_name, contractor, process_code, work_group, duty, team,
      phone, hire_date, bus_route, bus_stop, uniform_size, shoe_size, status, resign_date, resign_reason,
      remark, seq, use_yn)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(employee_no) DO UPDATE SET
     erp_code=excluded.erp_code, employee_qr=excluded.employee_qr, worker_name=excluded.worker_name,
     contractor=excluded.contractor, process_code=excluded.process_code, work_group=excluded.work_group,
     duty=excluded.duty, team=excluded.team, phone=excluded.phone, hire_date=excluded.hire_date,
     bus_route=excluded.bus_route, bus_stop=excluded.bus_stop, uniform_size=excluded.uniform_size,
     shoe_size=excluded.shoe_size, status=excluded.status, resign_date=excluded.resign_date,
     resign_reason=excluded.resign_reason, remark=excluded.remark, seq=excluded.seq, use_yn=excluded.use_yn`
);

let inserted = 0;
let skipped = 0;
const workGroupCounts = {};

db.exec("BEGIN");
try {
  for (const r of rows.slice(3)) {
    const employeeNo = strOrNull(r[2]);
    const workerName = strOrNull(r[6]);
    if (!employeeNo || !workerName) {
      skipped++;
      continue;
    }
    const seq = Number(r[0]) || 0;
    const statusRaw = strOrNull(r[1]); // 정상/휴직
    const erpCode = strOrNull(r[3]);
    const employeeQr = strOrNull(r[4]);
    const contractor = strOrNull(r[5]);
    const hireDate = dateOrNull(r[7]);
    const workGroup = strOrNull(r[8]);
    const duty = strOrNull(r[9]);
    const team = strOrNull(r[10]);
    const phone = strOrNull(r[11]);
    const busRoute = strOrNull(r[12]);
    const busStop = strOrNull(r[13]);
    const uniformSize = strOrNull(r[14]);
    const shoeSize = strOrNull(r[15]);
    const resignDate = dateOrNull(r[16]);
    const resignReason = strOrNull(r[17]);
    const remark = strOrNull(r[18]);
    // 이 원본의 "공정"(work_group)은 BASE-04 세부 공정코드와 1:1로 대응하지 않아
    // process_code는 채우지 않는다(db.ts 스키마 주석 참고) — work_group에만 원문 보존.
    const processCode = null;
    const useYn = resignDate ? "N" : "Y";

    upsert.run(
      employeeNo, erpCode, employeeQr, workerName, contractor, processCode, workGroup, duty, team,
      phone, hireDate, busRoute, busStop, uniformSize, shoeSize, statusRaw, resignDate, resignReason,
      remark, seq, useYn
    );
    inserted++;
    if (workGroup) workGroupCounts[workGroup] = (workGroupCounts[workGroup] || 0) + 1;
  }
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}

console.log(`inserted/updated: ${inserted}, skipped(사번 or 성명 없음): ${skipped}`);
console.log("work_group counts:", workGroupCounts);
const total = db.prepare("SELECT COUNT(*) AS c FROM workers").get();
console.log("workers table total rows:", total.c);
