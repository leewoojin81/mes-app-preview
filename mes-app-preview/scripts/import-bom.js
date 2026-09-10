// Import BOM.xlsx (다단계 전개형 BOM) into the bom table.
//
// BOM.xlsx는 레벨별로 들여쓰기된 전개형 BOM이다 (Level 열: 0, *1, **2, ...).
// 같은 레벨 안에서 직전 상위 레벨의 자품목코드가 현재 행의 실제 부모가 되므로,
// 레벨을 스택으로 추적해 (부모품목코드, 자품목코드) 직속 관계만 뽑아낸다.
//
// Usage:
//   node scripts/import-bom.js
//
// Run from the mes-app directory (paths are resolved relative to this file).

const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const XLSX = require("xlsx");

const ROOT = path.join(__dirname, "..", ".."); // mes-system/
const DB_PATH = path.join(__dirname, "..", "data", "mes.db");
const SOURCE_FILE = path.join(ROOT, "BOM.xlsx");

// BOM.xlsx의 "계정" 값 -> items.category 매핑 (items 테이블은 3종만 허용)
const CATEGORY_MAP = {
  완제품: "완제품",
  반제품: "반제품",
  원자재: "원자재",
  부자재: "원자재",
};

function parseDepth(levelRaw) {
  if (levelRaw === 0 || levelRaw === "0") return 0;
  const m = String(levelRaw ?? "").match(/^\*+([0-9]+)$/);
  return m ? parseInt(m[1], 10) : null;
}

function main() {
  if (!fs.existsSync(SOURCE_FILE)) {
    throw new Error(`파일을 찾을 수 없습니다: ${SOURCE_FILE}`);
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON;");

  const wb = XLSX.readFile(SOURCE_FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const header = rows[0];
  const idx = (name) => {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`Column not found: ${name}`);
    return i;
  };
  const iLevel = idx("Level");
  const iChild = idx("자품목코드");
  const iName = idx("품목명");
  const iSpec = idx("규격");
  const iAccount = idx("계정");
  const iUnit = idx("단위");
  const iQty = idx("표준원수");

  // 1) 스택 기반으로 직속 (부모,자식) 엣지 추출. 같은 조합이 여러 트리에서
  //    재등장하면 최초 등장한 값을 채택한다(수량은 사실상 항상 동일함을 확인함).
  const edges = new Map(); // "parent|child" -> { parent, child, qty, unit }
  // 엣지에서 참조되는 품목의 메타(품목명/규격/계정/단위) — items에 없는 코드 보강용
  const itemMeta = new Map(); // code -> { name, spec, category, unit }
  const stack = [];
  let skippedBadLevel = 0;

  for (const r of rows.slice(1)) {
    const depth = parseDepth(r[iLevel]);
    if (depth === null) {
      skippedBadLevel++;
      continue;
    }
    const child = r[iChild] == null ? null : String(r[iChild]).trim();
    if (!child) continue;

    const name = r[iName] == null ? child : String(r[iName]).trim();
    const spec = r[iSpec] == null ? null : String(r[iSpec]).trim();
    const account = r[iAccount] == null ? null : String(r[iAccount]).trim();
    const unit = r[iUnit] == null ? null : String(r[iUnit]).trim();
    if (!itemMeta.has(child)) {
      itemMeta.set(child, { name, spec, category: CATEGORY_MAP[account] ?? null, unit: unit ?? "EA" });
    }

    if (depth === 0) {
      stack.length = 0;
      stack[0] = child;
      continue;
    }
    const parent = stack[depth - 1];
    stack.length = depth;
    stack[depth] = child;
    if (!parent) continue;

    const qty = typeof r[iQty] === "number" ? r[iQty] : null;
    const key = `${parent}|${child}`;
    if (!edges.has(key)) {
      edges.set(key, { parent, child, qty, unit });
    }
  }

  // 2) items 테이블에 없는 참조 품목코드를 BOM 시트 정보로 보강 등록
  const existingCodes = new Set(
    db.prepare("SELECT item_code FROM items").all().map((r) => r.item_code)
  );
  const referencedCodes = new Set();
  for (const { parent, child } of edges.values()) {
    referencedCodes.add(parent);
    referencedCodes.add(child);
  }
  const missingCodes = [...referencedCodes].filter((c) => !existingCodes.has(c));

  const insertItem = db.prepare(
    `INSERT INTO items (item_code, item_name, category, spec, unit)
     VALUES (?, ?, ?, ?, ?)`
  );
  db.exec("BEGIN");
  try {
    for (const code of missingCodes) {
      const meta = itemMeta.get(code) ?? { name: code, spec: null, category: null, unit: "EA" };
      insertItem.run(code, meta.name, meta.category ?? "원자재", meta.spec, meta.unit ?? "EA");
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  // 3) bom 테이블 반영
  const upsert = db.prepare(
    `INSERT INTO bom (bom_id, parent_item_code, child_item_code, qty_per, unit)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(parent_item_code, child_item_code) DO UPDATE SET
       qty_per = excluded.qty_per,
       unit = excluded.unit`
  );

  let inserted = 0;
  let updated = 0;
  let skippedNoQty = 0;
  const existingPairs = new Set(
    db.prepare("SELECT parent_item_code, child_item_code FROM bom").all().map(
      (r) => `${r.parent_item_code}|${r.child_item_code}`
    )
  );

  db.exec("BEGIN");
  try {
    for (const { parent, child, qty, unit } of edges.values()) {
      if (qty === null) {
        skippedNoQty++;
        continue;
      }
      const key = `${parent}|${child}`;
      const bomId = key;
      upsert.run(bomId, parent, child, qty, unit);
      if (existingPairs.has(key)) updated++;
      else inserted++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  console.log(`Level 파싱 오류로 건너뜀: ${skippedBadLevel}건`);
  console.log(`보강 등록한 품목(items에 없던 코드): ${missingCodes.length}건`, missingCodes);
  console.log(`BOM 엣지 신규 ${inserted}건, 갱신 ${updated}건, 소요량 없음 건너뜀 ${skippedNoQty}건`);
  const total = db.prepare("SELECT COUNT(*) c FROM bom").get();
  console.log("bom 테이블 총 행수:", total.c);
}

main();
