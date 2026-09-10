// Import 설비등록.xlsx into the equipments table.
//
// Usage:
//   node scripts/import-equipments.js
//
// Run from the mes-app directory (paths are resolved relative to this file).

const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const XLSX = require("xlsx");

const ROOT = path.join(__dirname, "..", ".."); // mes-system/
const DB_PATH = path.join(__dirname, "..", "data", "mes.db");
const SOURCE_FILE = path.join(ROOT, "설비등록.xlsx");

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS equipments (
      equipment_id TEXT PRIMARY KEY,
      equipment_name TEXT NOT NULL,
      workplace TEXT,
      equipment_group TEXT,
      personnel REAL,
      wage_rate REAL,
      ton REAL,
      line_id TEXT,
      bf_warehouse TEXT,
      defect_warehouse TEXT,
      defect_pattern TEXT,
      daily_work_minutes REAL,
      work_time_type TEXT,
      uph REAL,
      work_efficiency REAL,
      seq INTEGER NOT NULL DEFAULT 0,
      use_yn TEXT NOT NULL DEFAULT 'Y',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);
}

function num(v) {
  return typeof v === "number" ? v : null;
}
function str(v) {
  return v == null ? null : String(v).trim();
}

function main() {
  if (!fs.existsSync(SOURCE_FILE)) {
    throw new Error(`파일을 찾을 수 없습니다: ${SOURCE_FILE}`);
  }
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }
  const db = new DatabaseSync(DB_PATH);
  ensureSchema(db);

  const wb = XLSX.readFile(SOURCE_FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const header = rows[0];
  const idx = (name) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`Column not found: ${name}`);
    return i;
  };
  const iWorkplace = idx("작업장");
  const iGroup = idx("설비군");
  const iCode = idx("설비");
  const iName = idx("설비명");
  const iPersonnel = idx("인원");
  const iWage = idx("분당임율");
  const iTon = idx("Ton");
  const iLine = idx("라인");
  const iBf = idx("B/F창고");
  const iDefectWh = idx("불량창고");
  const iDefectPattern = idx("불량패턴");
  const iDailyMin = idx("일취업시간(분)");
  const iWorkTimeType = idx("작업시간Type");
  const iUph = idx("UPH");
  const iEfficiency = idx("작업효율%");
  const iUse = idx("사용");
  const iSeq = idx("정렬");

  const insert = db.prepare(
    `INSERT INTO equipments
       (equipment_id, equipment_name, workplace, equipment_group, personnel, wage_rate, ton, line_id,
        bf_warehouse, defect_warehouse, defect_pattern, daily_work_minutes, work_time_type, uph, work_efficiency, seq, use_yn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(equipment_id) DO UPDATE SET
       equipment_name = excluded.equipment_name,
       workplace = excluded.workplace,
       equipment_group = excluded.equipment_group,
       personnel = excluded.personnel,
       wage_rate = excluded.wage_rate,
       ton = excluded.ton,
       line_id = excluded.line_id,
       bf_warehouse = excluded.bf_warehouse,
       defect_warehouse = excluded.defect_warehouse,
       defect_pattern = excluded.defect_pattern,
       daily_work_minutes = excluded.daily_work_minutes,
       work_time_type = excluded.work_time_type,
       uph = excluded.uph,
       work_efficiency = excluded.work_efficiency,
       seq = excluded.seq,
       use_yn = excluded.use_yn`
  );

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  db.exec("BEGIN");
  try {
    for (const r of rows.slice(1)) {
      const code = str(r[iCode]);
      if (!code) {
        skipped++;
        continue;
      }
      const exists = db.prepare("SELECT 1 FROM equipments WHERE equipment_id=?").get(code);
      // "사용" 컬럼: 1=사용, 그 외(2 등)=중단
      const useYn = str(r[iUse]) === "1" ? "Y" : "N";

      insert.run(
        code,
        str(r[iName]) ?? code,
        str(r[iWorkplace]),
        str(r[iGroup]),
        num(r[iPersonnel]),
        num(r[iWage]),
        num(r[iTon]),
        str(r[iLine]),
        str(r[iBf]),
        str(r[iDefectWh]),
        str(r[iDefectPattern]),
        num(r[iDailyMin]),
        str(r[iWorkTimeType]),
        num(r[iUph]),
        num(r[iEfficiency]),
        num(r[iSeq]) ?? 0,
        useYn
      );
      if (exists) updated++;
      else inserted++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  console.log(`신규 ${inserted}건, 갱신 ${updated}건, 건너뜀(설비코드 없음) ${skipped}건`);
  const totals = db.prepare("SELECT use_yn, COUNT(*) c FROM equipments GROUP BY use_yn").all();
  console.log("사용여부별 건수:", totals);
}

main();
