// 재고 수불 원장 서버 로직 — 기초재고 적재, 업로드 데이터에서 증감 자동 반영, 대사 쿼리.
// 스키마는 db.ts의 CREATE TABLE IF NOT EXISTS로만 만들고, 이 파일은 INSERT/SELECT만 한다
// (UPDATE/DELETE/DROP 없음 — 원장은 추가 전용).
import type { DatabaseSync } from "node:sqlite";
import type { StockBaseline } from "./stock-ledger-shared";

export const SYSTEM_USER = "시스템(자동반영)";
const QTY_EPS = 0.0005;

export function getBaseline(db: DatabaseSync): StockBaseline | null {
  return (
    (db.prepare("SELECT * FROM stock_ledger_baseline ORDER BY id LIMIT 1").get() as StockBaseline | undefined) ??
    null
  );
}

/** 현재고현황(INV-02) 스냅샷을 품목×LOT×창고로 합산한 기초재고 후보 요약. */
export function snapshotSummary(db: DatabaseSync) {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(q), 0) AS total
       FROM (SELECT SUM(stock_qty) AS q FROM inventory_status
             WHERE item_code IS NOT NULL AND item_code <> '' AND warehouse IS NOT NULL AND warehouse <> ''
             GROUP BY item_code, TRIM(COALESCE(lot_no, '')), warehouse
             HAVING ABS(SUM(stock_qty)) > ${QTY_EPS})`
    )
    .get() as { n: number; total: number };
  const up = (db.prepare("SELECT MAX(uploaded_at) AS t FROM inventory_status").get() as { t: string | null }).t;
  return { rows: r.n, total: r.total, uploadedAt: up };
}

/** 기초재고 1회 적재. 이미 적재됐으면 null. */
export function loadBaseline(db: DatabaseSync, baseDate: string, user: string) {
  if (getBaseline(db)) return null;
  const snap = snapshotSummary(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    // 동시 요청 방어 — 트랜잭션 안에서 한 번 더 확인
    if (getBaseline(db)) {
      db.exec("ROLLBACK");
      return null;
    }
    db.prepare(
      `INSERT INTO stock_ledger (tx_at, item_code, lot_no, warehouse, tx_type, qty, reason, ref_no, source_key, created_by)
       SELECT ? || ' 00:00:00', item_code, TRIM(COALESCE(lot_no, '')), warehouse, '입고', ROUND(SUM(stock_qty), 3),
              '기초재고', 'BASE-' || ?, 'BASE|' || item_code || '|' || TRIM(COALESCE(lot_no, '')) || '|' || warehouse, ?
       FROM inventory_status
       WHERE item_code IS NOT NULL AND item_code <> '' AND warehouse IS NOT NULL AND warehouse <> ''
       GROUP BY item_code, TRIM(COALESCE(lot_no, '')), warehouse
       HAVING ABS(SUM(stock_qty)) > ${QTY_EPS}`
    ).run(baseDate, baseDate.replaceAll("-", ""), user);
    db.prepare(
      "INSERT INTO stock_ledger_baseline (base_date, snapshot_uploaded_at, row_count, total_qty, created_by) VALUES (?, ?, ?, ?, ?)"
    ).run(baseDate, snap.uploadedAt, snap.rows, snap.total, user);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { ...snap, baseDate };
}

// 업로드 데이터 → 수불 자동 반영 정의. 각 소스는 기초재고 기준일 '이후' 날짜 행만 대상(기준일 당일
// 거래는 스냅샷에 이미 포함된 것으로 간주). source_key 유니크로 같은 원본 행은 한 번만 쌓인다.
const J = (k: string) => `json_extract(detail, '$."${k}"')`;
const LOT = (expr: string) => `TRIM(COALESCE(${expr}, ''))`;

function build(p: {
  table: string;
  dateCol: string;
  keyPrefix: string;
  keyCol: string;
  item: string;
  lot: string;
  wh: string;
  rawQty: string;
  sign: 1 | -1;
  txType: string;
  reason: string;
  ref: string;
  extraWhere?: string;
}) {
  // 품목코드가 영숫자로 시작하지 않는 행은 ERP 리포트의 합계/빈 행(예: 'Monthly Total')이라 제외한다.
  const valid = `${p.item} GLOB '[A-Za-z0-9]*' AND ${p.wh} IS NOT NULL AND TRIM(${p.wh}) <> '' AND ${p.rawQty} IS NOT NULL AND ${p.rawQty} <> 0`;
  const from = `FROM ${p.table} WHERE ${p.dateCol} > ? ${p.extraWhere ? "AND " + p.extraWhere : ""}`;
  const qty = `${p.sign < 0 ? "-" : ""}ROUND(${p.rawQty}, 3)`;
  return {
    countSql: `SELECT COUNT(*) AS c ${from}`,
    skipSql: `SELECT COUNT(*) AS c ${from} AND NOT (${valid})`,
    insertSql: `INSERT OR IGNORE INTO stock_ledger (tx_at, item_code, lot_no, warehouse, tx_type, qty, reason, ref_no, source_key, created_by)
      SELECT ${p.dateCol} || ' 00:00:00', ${p.item}, ${LOT(p.lot)}, TRIM(${p.wh}), '${p.txType}', ${qty}, ${p.reason},
             ${p.ref}, '${p.keyPrefix}|' || ${p.keyCol}, '${SYSTEM_USER}'
      ${from} AND (${valid})`,
  };
}

const SOURCES = [
  {
    label: "구매입고",
    ...build({
      table: "purchase_receipt_status", dateCol: "receipt_date", keyPrefix: "PUR", keyCol: "record_key",
      item: "item_code", lot: "lot_no", wh: J("입고창고"), rawQty: J("입고량"), sign: 1,
      txType: "입고", reason: `COALESCE(NULLIF(${J("입고유형")}, ''), '구매입고')`, ref: "receipt_no",
    }),
  },
  {
    label: "MOLD입고",
    ...build({
      table: "mold_receipt_status", dateCol: "receipt_date", keyPrefix: "MOLD", keyCol: "record_key",
      item: "item_code", lot: "lot_no", wh: "warehouse", rawQty: J("입고량"), sign: 1,
      txType: "입고", reason: "'MOLD입고'", ref: "receipt_no",
    }),
  },
  {
    label: "창고이동(출발)",
    ...build({
      table: "warehouse_transfer_status", dateCol: "transfer_date", keyPrefix: "TRF-OUT", keyCol: "record_key",
      item: "item_code", lot: "lot_no", wh: "from_warehouse", rawQty: J("출고수량"), sign: -1,
      txType: "이동", reason: "'창고이동'", ref: "transfer_no", extraWhere: "from_warehouse <> to_warehouse",
    }),
  },
  {
    // 도착 쪽은 입고품목/입고수량 기준(원본에서 출고품목과 다를 수 있음). 품목이 비면 출고품목으로 대체.
    label: "창고이동(도착)",
    ...build({
      table: "warehouse_transfer_status", dateCol: "transfer_date", keyPrefix: "TRF-IN", keyCol: "record_key",
      item: `COALESCE(NULLIF(${J("입고품목")}, ''), item_code)`, lot: "lot_no", wh: "to_warehouse",
      rawQty: J("입고수량"), sign: 1,
      txType: "이동", reason: "'창고이동'", ref: "transfer_no", extraWhere: "from_warehouse <> to_warehouse",
    }),
  },
  {
    // 출하 — 수주번호가 있으면 참조번호로, 없으면 출고번호. 반품이면 출고수량이 음수라 부호가 뒤집혀 +가 된다.
    label: "출하",
    ...build({
      table: "product_shipment_status", dateCol: "ship_date", keyPrefix: "SHIP", keyCol: "shipment_no",
      item: "item_code", lot: J("Lotno"), wh: J("출고창고"), rawQty: J("출고수량"), sign: -1,
      txType: "출고", reason: "'출하'", ref: "COALESCE(NULLIF(so_no, ''), shipment_no)",
    }),
  },
];

export interface SyncResult {
  label: string;
  candidates: number; // 기준일 이후 원본 행 수
  skipped: number; // 창고·수량 누락 등으로 반영 불가
  inserted: number; // 이번에 새로 쌓인(또는 dryRun이면 쌓일) 건수
}

/** dryRun이면 새로 쌓일 건수만 계산(마지막에 롤백). */
export function syncLedger(db: DatabaseSync, baseDate: string, dryRun: boolean): SyncResult[] {
  const out: SyncResult[] = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const s of SOURCES) {
      const candidates = (db.prepare(s.countSql).get(baseDate) as { c: number }).c;
      const skipped = (db.prepare(s.skipSql).get(baseDate) as { c: number }).c;
      const inserted = Number(db.prepare(s.insertSql).run(baseDate).changes);
      out.push({ label: s.label, candidates, skipped, inserted });
    }
    db.exec(dryRun ? "ROLLBACK" : "COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return out;
}

// 대사 — ERP 스냅샷(inventory_status)과 MES 수불 합계를 품목×LOT×창고 키로 비교.
export interface ReconcileFilter {
  warehouse?: string;
  search?: string;
  asOf?: string; // MES 수불 집계 기준일(포함). 비면 전체
  kind?: string; // diff | erp_only | mes_only | match | ""(전체)
  diffOnly?: boolean;
}

export function reconcileSql(f: ReconcileFilter) {
  const args: (string | number)[] = [];
  const mesWhere = f.asOf ? "WHERE substr(tx_at, 1, 10) <= ?" : "";
  if (f.asOf) args.push(f.asOf);
  const outer: string[] = [];
  if (f.warehouse) {
    outer.push("k.warehouse = ?");
    args.push(f.warehouse);
  }
  if (f.search) {
    outer.push("(k.item_code LIKE ? OR k.lot_no LIKE ? OR k.warehouse LIKE ? OR i.item_name LIKE ?)");
    const like = `%${f.search}%`;
    args.push(like, like, like, like);
  }
  const kindExpr = `CASE
      WHEN e.qty IS NULL THEN 'mes_only'
      WHEN m.qty IS NULL THEN 'erp_only'
      WHEN ABS(m.qty - e.qty) > ${QTY_EPS} THEN 'diff'
      ELSE 'match' END`;
  // 합계가 0인 키는 양쪽 모두에서 제외 — 한쪽에만 0으로 남은 키가 'only'로 잡히지 않도록.
  const cte = `
    WITH erp AS (
      SELECT item_code, TRIM(COALESCE(lot_no, '')) AS lot_no, warehouse, ROUND(SUM(stock_qty), 3) AS qty
      FROM inventory_status
      WHERE item_code IS NOT NULL AND item_code <> '' AND warehouse IS NOT NULL AND warehouse <> ''
      GROUP BY 1, 2, 3
      HAVING ABS(SUM(stock_qty)) > ${QTY_EPS}
    ), mes AS (
      SELECT item_code, lot_no, warehouse, ROUND(SUM(qty), 3) AS qty
      FROM stock_ledger ${mesWhere}
      GROUP BY 1, 2, 3
      HAVING ABS(SUM(qty)) > ${QTY_EPS}
    ), keys AS (
      SELECT item_code, lot_no, warehouse FROM erp
      UNION
      SELECT item_code, lot_no, warehouse FROM mes
    ), joined AS (
      SELECT k.item_code, k.lot_no, k.warehouse, i.item_name,
             COALESCE(e.qty, 0) AS erp_qty, COALESCE(m.qty, 0) AS mes_qty,
             ROUND(COALESCE(m.qty, 0) - COALESCE(e.qty, 0), 3) AS diff,
             ${kindExpr} AS kind
      FROM keys k
      LEFT JOIN erp e ON e.item_code = k.item_code AND e.lot_no = k.lot_no AND e.warehouse = k.warehouse
      LEFT JOIN mes m ON m.item_code = k.item_code AND m.lot_no = k.lot_no AND m.warehouse = k.warehouse
      LEFT JOIN items i ON i.item_code = k.item_code
      ${outer.length ? "WHERE " + outer.join(" AND ") : ""}
    )`;
  const listWhere: string[] = [];
  if (f.diffOnly) listWhere.push("kind <> 'match'");
  if (f.kind && ["diff", "erp_only", "mes_only", "match"].includes(f.kind)) listWhere.push(`kind = '${f.kind}'`);
  return { cte, args, listWhere: listWhere.length ? "WHERE " + listWhere.join(" AND ") : "" };
}
