// Import 완제품/반제품/원부자재 master data into the items table.
// 사용여부는 use_yn 컬럼으로 저장한다 (화면의 전체/사용/중단 필터용).
//
// Usage:
//   node scripts/import-items.js --limit 300   # test run: only first N rows per source file
//   node scripts/import-items.js                # full import of all usable rows
//
// Run from the mes-app directory (paths are resolved relative to this file).

const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const XLSX = require("xlsx");

const ROOT = path.join(__dirname, "..", ".."); // mes-system/
const DB_PATH = path.join(__dirname, "..", "data", "mes.db");

const SOURCES = [
  { file: "완제품등록.xlsx", category: "완제품" },
  { file: "반제품등록.xlsx", category: "반제품" },
  { file: "원부자재등록.xlsx", category: "원자재" },
];

const LEGACY_SAMPLE_ITEM_CODES = [
  "LENS-CR39-100",
  "LENS-CR39-200",
  "LENS-HI60-150",
  "RM-RESIN-CR39",
  "RM-RESIN-HI60",
  "RM-COAT-HC",
];

function parseArgs(argv) {
  const args = { limit: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") {
      args.limit = parseInt(argv[i + 1], 10);
      i++;
    }
  }
  return args;
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      item_code TEXT PRIMARY KEY,
      item_name TEXT NOT NULL,
      category TEXT NOT NULL,
      spec TEXT,
      unit TEXT NOT NULL DEFAULT 'EA',
      warehouse TEXT,
      safety_stock REAL
    );
  `);
  const cols = db.prepare("PRAGMA table_info(items)").all().map((c) => c.name);
  if (!cols.includes("warehouse")) db.exec("ALTER TABLE items ADD COLUMN warehouse TEXT");
  if (!cols.includes("safety_stock")) db.exec("ALTER TABLE items ADD COLUMN safety_stock REAL");
  if (!cols.includes("detail")) db.exec("ALTER TABLE items ADD COLUMN detail TEXT");
  // 원본 엑셀 "No." 컬럼 값 — 화면 정렬용
  if (!cols.includes("seq_no")) db.exec("ALTER TABLE items ADD COLUMN seq_no REAL");
  // 원본 엑셀 "사용여부" — 화면의 전체/사용/중단 필터용
  if (!cols.includes("use_yn")) db.exec("ALTER TABLE items ADD COLUMN use_yn TEXT NOT NULL DEFAULT 'Y'");
}

function removeLegacySamples(db) {
  const placeholders = LEGACY_SAMPLE_ITEM_CODES.map(() => "?").join(",");
  db.exec("PRAGMA foreign_keys = OFF;"); // targeted cleanup of known demo rows only
  db.prepare(`DELETE FROM inventory WHERE item_code IN (${placeholders})`).run(...LEGACY_SAMPLE_ITEM_CODES);
  db.prepare(`DELETE FROM material_inputs WHERE material_lot_no IN (SELECT lot_no FROM lots WHERE item_code IN (${placeholders}))`).run(...LEGACY_SAMPLE_ITEM_CODES);
  db.prepare(`DELETE FROM production_results WHERE lot_no IN (SELECT lot_no FROM lots WHERE item_code IN (${placeholders}))`).run(...LEGACY_SAMPLE_ITEM_CODES);
  db.prepare(`DELETE FROM defects WHERE lot_no IN (SELECT lot_no FROM lots WHERE item_code IN (${placeholders}))`).run(...LEGACY_SAMPLE_ITEM_CODES);
  db.prepare(`DELETE FROM lots WHERE item_code IN (${placeholders})`).run(...LEGACY_SAMPLE_ITEM_CODES);
  db.prepare(`DELETE FROM work_orders WHERE item_code IN (${placeholders})`).run(...LEGACY_SAMPLE_ITEM_CODES);
  const result = db.prepare(`DELETE FROM items WHERE item_code IN (${placeholders})`).run(...LEGACY_SAMPLE_ITEM_CODES);
  db.exec("PRAGMA foreign_keys = ON;");
  console.log(`legacy sample items removed: ${result.changes}`);
}

function readUsableRows(filePath, limit) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const header = rows[0];
  const idx = (name) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`Column not found: ${name} in ${filePath}`);
    return i;
  };
  const iNo = idx("No.");
  const iCode = idx("품목코드");
  const iName = idx("품명");
  const iSpec = idx("규격");
  const iUnit = idx("단위");
  const iWh = idx("입고창고");
  const iSafety = idx("안전재고");
  const iUse = idx("사용여부");

  const out = [];
  for (const r of rows.slice(1)) {
    const code = r[iCode] == null ? null : String(r[iCode]).trim();
    if (!code) continue;
    // full source row keyed by header name, in original column order
    const detail = {};
    header.forEach((name, i) => {
      if (name == null || name === "") return;
      detail[name] = r[i] == null ? null : r[i];
    });
    out.push({
      item_code: code,
      item_name: r[iName] == null ? code : String(r[iName]).trim(),
      spec: r[iSpec] == null ? null : String(r[iSpec]).trim(),
      unit: r[iUnit] == null ? "EA" : String(r[iUnit]).trim(),
      warehouse: r[iWh] == null ? null : String(r[iWh]).trim(),
      safety_stock: typeof r[iSafety] === "number" ? r[iSafety] : null,
      seq_no: typeof r[iNo] === "number" ? r[iNo] : null,
      use_yn: r[iUse] === "N" ? "N" : "Y",
      detail: JSON.stringify(detail),
    });
    if (limit && out.length >= limit) break;
  }
  return out;
}

function main() {
  const { limit } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON;");
  ensureSchema(db);
  removeLegacySamples(db);

  const insert = db.prepare(
    `INSERT INTO items (item_code, item_name, category, spec, unit, warehouse, safety_stock, seq_no, use_yn, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_code) DO UPDATE SET
       item_name = excluded.item_name,
       category = excluded.category,
       spec = excluded.spec,
       unit = excluded.unit,
       warehouse = excluded.warehouse,
       safety_stock = excluded.safety_stock,
       seq_no = excluded.seq_no,
       use_yn = excluded.use_yn,
       detail = excluded.detail`
  );

  const summary = [];
  for (const { file, category } of SOURCES) {
    const filePath = path.join(ROOT, file);
    const rows = readUsableRows(filePath, limit);

    db.exec("BEGIN");
    try {
      for (const row of rows) {
        insert.run(row.item_code, row.item_name, category, row.spec, row.unit, row.warehouse, row.safety_stock, row.seq_no, row.use_yn, row.detail);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    summary.push({ file, category, imported: rows.length });
  }

  console.log(limit ? `TEST RUN (limit=${limit} per file)` : "FULL RUN");
  console.table(summary);

  const totals = db.prepare("SELECT category, COUNT(*) as c FROM items GROUP BY category").all();
  console.log("items table totals by category:");
  console.table(totals);
}

main();
