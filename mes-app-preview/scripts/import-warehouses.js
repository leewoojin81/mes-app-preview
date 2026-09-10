// Import 창고코드등록.xlsx into the warehouses table.
//
// Usage:
//   node scripts/import-warehouses.js
//
// Run from the mes-app directory (paths are resolved relative to this file).

const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const XLSX = require("xlsx");

const ROOT = path.join(__dirname, "..", ".."); // mes-system/
const DB_PATH = path.join(__dirname, "..", "data", "mes.db");
const SOURCE_FILE = path.join(ROOT, "창고코드등록.xlsx");

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS warehouses (
      warehouse_code TEXT PRIMARY KEY,
      warehouse_name TEXT NOT NULL,
      workplace TEXT,
      procure_type TEXT,
      warehouse_type TEXT,
      seq INTEGER NOT NULL DEFAULT 0,
      use_yn TEXT NOT NULL DEFAULT 'Y',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);
}

function str(v) {
  return v == null ? null : String(v).trim() || null;
}
function num(v) {
  return typeof v === "number" ? v : null;
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

  const iSeq = idx("순서");
  const iCode = idx("코드");
  const iName = idx("창고명");
  const iWorkplace = idx("사업장");
  const iProcure = idx("조달구분");
  const iType = idx("창고유형");

  const insert = db.prepare(
    `INSERT INTO warehouses
       (warehouse_code, warehouse_name, workplace, procure_type, warehouse_type, seq, use_yn)
     VALUES (?, ?, ?, ?, ?, ?, 'Y')
     ON CONFLICT(warehouse_code) DO UPDATE SET
       warehouse_name = excluded.warehouse_name,
       workplace = excluded.workplace,
       procure_type = excluded.procure_type,
       warehouse_type = excluded.warehouse_type,
       seq = excluded.seq`
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
      const exists = db.prepare("SELECT 1 FROM warehouses WHERE warehouse_code=?").get(code);

      insert.run(
        code,
        str(r[iName]) ?? code,
        str(r[iWorkplace]),
        str(r[iProcure]),
        str(r[iType]),
        num(r[iSeq]) ?? 0
      );
      if (exists) updated++;
      else inserted++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  console.log(`신규 ${inserted}건, 갱신 ${updated}건, 건너뜀(창고코드 없음) ${skipped}건`);
}

main();
