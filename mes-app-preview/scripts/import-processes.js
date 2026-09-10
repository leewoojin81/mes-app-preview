// Import 공정코드등록.xlsx into the processes table.
//
// Usage:
//   node scripts/import-processes.js
//
// Run from the mes-app directory (paths are resolved relative to this file).

const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const XLSX = require("xlsx");

const ROOT = path.join(__dirname, "..", ".."); // mes-system/
const DB_PATH = path.join(__dirname, "..", "data", "mes.db");
const SOURCE_FILE = path.join(ROOT, "공정코드등록.xlsx");

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS processes (
      process_code TEXT PRIMARY KEY,
      process_name TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      procure_type TEXT,
      productivity_type TEXT,
      process_group TEXT,
      process_group2 TEXT,
      single_process TEXT,
      use_yn TEXT NOT NULL DEFAULT 'Y',
      reg_date TEXT,
      reg_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);
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
  const iCode = idx("공정코드");
  const iName = idx("공정명");
  const iSeq = idx("공정순서");
  const iProcure = idx("조달구분");
  const iProd = idx("생산성구분");
  const iGroup = idx("공정그룹");
  const iGroup2 = idx("공정그룹2");
  const iSingle = idx("단공정");
  const iUse = idx("사용");
  const iRegDate = idx("등록일자");
  const iRegBy = idx("등록자");

  const insert = db.prepare(
    `INSERT INTO processes
       (process_code, process_name, seq, procure_type, productivity_type, process_group, process_group2, single_process, use_yn, reg_date, reg_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(process_code) DO UPDATE SET
       process_name = excluded.process_name,
       seq = excluded.seq,
       procure_type = excluded.procure_type,
       productivity_type = excluded.productivity_type,
       process_group = excluded.process_group,
       process_group2 = excluded.process_group2,
       single_process = excluded.single_process,
       use_yn = excluded.use_yn,
       reg_date = excluded.reg_date,
       reg_by = excluded.reg_by`
  );

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  db.exec("BEGIN");
  try {
    for (const r of rows.slice(1)) {
      const code = r[iCode] == null ? null : String(r[iCode]).trim();
      if (!code) {
        skipped++;
        continue;
      }
      const exists = db.prepare("SELECT 1 FROM processes WHERE process_code=?").get(code);
      // "사용" 컬럼: 1=사용, 그 외(2 등)=중단
      const useRaw = r[iUse] == null ? null : String(r[iUse]).trim();
      const useYn = useRaw === "1" ? "Y" : "N";
      // "단공정" 컬럼: 1=Y
      const singleRaw = r[iSingle] == null ? null : String(r[iSingle]).trim();
      const singleProcess = singleRaw === "1" ? "Y" : singleRaw ? "N" : null;

      insert.run(
        code,
        r[iName] == null ? code : String(r[iName]).trim(),
        typeof r[iSeq] === "number" ? r[iSeq] : 0,
        r[iProcure] == null ? null : String(r[iProcure]).trim(),
        r[iProd] == null ? null : String(r[iProd]).trim(),
        r[iGroup] == null ? null : String(r[iGroup]).trim(),
        r[iGroup2] == null ? null : String(r[iGroup2]).trim(),
        singleProcess,
        useYn,
        r[iRegDate] == null ? null : String(r[iRegDate]).trim(),
        r[iRegBy] == null ? null : String(r[iRegBy]).trim()
      );
      if (exists) updated++;
      else inserted++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  console.log(`신규 ${inserted}건, 갱신 ${updated}건, 건너뜀(공정코드 없음) ${skipped}건`);
  const totals = db.prepare("SELECT use_yn, COUNT(*) c FROM processes GROUP BY use_yn").all();
  console.log("사용여부별 건수:", totals);
}

main();
