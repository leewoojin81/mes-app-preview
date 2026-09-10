// Import 수주현황_20260814.xlsx into the sales_orders table.
// so_no is derived from the sheet's own order number + line sequence
// ("수주번호" + 순번), which is unique and stable across re-imports —
// re-running this script safely upserts instead of duplicating rows.
// The full source row (all named columns) is preserved as JSON in
// the `detail` column so the 수주등록 screen can show it as-is.
//
// Usage:
//   node scripts/import-sales-orders.js
//
// Run from the mes-app directory (paths are resolved relative to this file).

const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const XLSX = require("xlsx");

const ROOT = path.join(__dirname, "..", ".."); // mes-system/
const DB_PATH = path.join(__dirname, "..", "data", "mes.db");
const SOURCE_FILE = path.join(ROOT, "수주현황_20260814.xlsx");

// status 컬럼(내부 조회용 폴백)도 detail.상태와 동일한 값(수주/Packing/출고/완료/중단)을 그대로 쓴다.
const VALID_STATUS = new Set(["수주", "Packing", "출고", "완료", "중단"]);

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function num(v) {
  return typeof v === "number" ? v : null;
}
// '2026.01.23' -> '2026-01-23'
function toIsoDate(v) {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
}
function toDateTime(v) {
  const iso = toIsoDate(v);
  return iso ? `${iso} 00:00:00` : null;
}

function ensureSchema(db) {
  const cols = db.prepare("PRAGMA table_info(sales_orders)").all().map((c) => c.name);
  if (!cols.includes("detail")) db.exec("ALTER TABLE sales_orders ADD COLUMN detail TEXT");
}

function main() {
  if (!fs.existsSync(SOURCE_FILE)) {
    throw new Error(`파일을 찾을 수 없습니다: ${SOURCE_FILE}`);
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON;");
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

  const iCustCode = idx("코드");
  const iItemCode = idx("품목코드");
  const iQty = idx("수량");
  const iUnitPrice = idx("단가");
  const iDueDate = idx("납기일자");
  const iStatus = idx("상태");
  const iRegDate = idx("등록일");
  const iOrderNo = idx("수주번호");
  // 헤더에 "순번"이 두 번 나온다 — 앞쪽은 항상 0인 상수, 실제 라인 일련번호는 뒤쪽 것.
  const iLineSeq = header.lastIndexOf("순번");

  const custCodes = new Set(
    db.prepare("SELECT customer_code FROM customers").all().map((c) => c.customer_code)
  );
  const itemCodes = new Set(
    db.prepare("SELECT item_code FROM items").all().map((i) => i.item_code)
  );

  // 엑셀 임포트분(detail 있는 행)만 이번 파일 기준으로 갈아끼운다.
  // 수동 등록된 수주(detail 없음)는 영향받지 않는다.
  db.exec("DELETE FROM sales_orders WHERE detail IS NOT NULL");

  const upsert = db.prepare(
    `INSERT INTO sales_orders
       (so_no, customer_code, item_code, order_qty, unit_price, due_date, status, created_at, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(so_no) DO UPDATE SET
       customer_code = excluded.customer_code,
       item_code = excluded.item_code,
       order_qty = excluded.order_qty,
       unit_price = excluded.unit_price,
       due_date = excluded.due_date,
       status = excluded.status,
       created_at = excluded.created_at,
       detail = excluded.detail`
  );

  let upserted = 0;
  let skipped = 0;
  const skipReasons = {};

  db.exec("BEGIN");
  try {
    for (const r of rows.slice(1)) {
      const customerCode = str(r[iCustCode]);
      const itemCode = str(r[iItemCode]);
      const qty = num(r[iQty]);
      const orderNo = str(r[iOrderNo]);
      const lineSeq = r[iLineSeq];

      if (!customerCode || !itemCode || !qty || qty <= 0 || !orderNo || lineSeq == null) {
        skipped++;
        skipReasons.invalid = (skipReasons.invalid || 0) + 1;
        continue;
      }
      if (!custCodes.has(customerCode)) {
        skipped++;
        skipReasons.customer_not_found = (skipReasons.customer_not_found || 0) + 1;
        continue;
      }
      if (!itemCodes.has(itemCode)) {
        skipped++;
        skipReasons.item_not_found = (skipReasons.item_not_found || 0) + 1;
        continue;
      }

      const so_no = `${orderNo}-${lineSeq}`;
      const statusRaw = str(r[iStatus]);
      const status = statusRaw && VALID_STATUS.has(statusRaw) ? statusRaw : "수주";
      const createdAt =
        toDateTime(r[iRegDate]) ?? new Date().toISOString().slice(0, 19).replace("T", " ");

      // 원본 시트 전체 컬럼을 헤더명 기준으로 그대로 보존 (화면에서 그대로 표시).
      // "순번"처럼 헤더명이 중복되는 컬럼은 두 번째부터 "이름__2" 형식의 고유 키로 저장한다.
      const detail = {};
      const headerSeen = {};
      header.forEach((name, i) => {
        if (name == null || name === "") return;
        const n = (headerSeen[name] = (headerSeen[name] ?? 0) + 1);
        const key = n === 1 ? name : `${name}__${n}`;
        detail[key] = r[i] == null ? null : r[i];
      });

      upsert.run(
        so_no,
        customerCode,
        itemCode,
        qty,
        num(r[iUnitPrice]),
        toIsoDate(r[iDueDate]),
        status,
        createdAt,
        JSON.stringify(detail)
      );
      upserted++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  console.log(`반영 ${upserted}건, 건너뜀 ${skipped}건`, skipReasons);
  const totals = db.prepare("SELECT status, COUNT(*) c FROM sales_orders GROUP BY status").all();
  console.log("상태별 건수:", totals);
}

main();
