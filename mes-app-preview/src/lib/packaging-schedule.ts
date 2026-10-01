import type { DatabaseSync } from "node:sqlite";

// 계획정보(PLAN-03) "출하포장" — 포장 라인별·일자별 포장 계획표("2026년 포장_20261001.xlsx" 1번 시트)를
// 그대로 옮긴 화면의 데이터. 라인(1~5 Line/기타/바이알) × 날짜 한 칸에 품명·계획(수량)·개입수·고객사·
// 납기일·수주번호를 적는다. 수주번호를 넣으면 수주현황(sales_orders)에서 고객사·품명·개입수·납기일을
// 자동으로 채운다(엑셀의 VLOOKUP과 같은 동작). 실적은 일일작업현황(PROD-10)의 포장공정(P410) 양품수량을
// 포장 라인(자동포장기 N호기/포장 0N호기)별로 합산해 읽기 전용으로 붙인다.

export interface PackagingLine {
  key: string;
  label: string;
  sub: string;
  /** 일일작업현황 "라인" 이름 — 실적을 읽어 올 라인(없으면 실적 없음) */
  actualLines: string[];
}

export const PACKAGING_LINES: PackagingLine[] = [
  { key: "line1", label: "1 Line", sub: "Auto (Monthly)", actualLines: ["자동포장기 1호기"] },
  { key: "line2", label: "2 Line", sub: "Auto (One day)", actualLines: ["자동포장기 2호기"] },
  { key: "line3", label: "3 Line", sub: "Auto (Monthly)", actualLines: ["자동포장기 3호기"] },
  { key: "line4", label: "4 Line", sub: "Manual (Conveyor)", actualLines: ["포장 04호기"] },
  { key: "line5", label: "5 Line", sub: "Manual (Conveyor)", actualLines: ["포장 05호기"] },
  { key: "etc", label: "기타", sub: "", actualLines: [] },
  { key: "vial", label: "바이알", sub: "", actualLines: [] },
];

export const PACKAGING_FIELDS = ["product_name", "plan_qty", "pack_size", "customer", "due_date", "so_no"] as const;
export type PackagingField = (typeof PACKAGING_FIELDS)[number];

export interface PackagingCell {
  plan_date: string;
  line_key: string;
  product_name: string | null;
  plan_qty: number | null;
  pack_size: string | null;
  customer: string | null;
  due_date: string | null;
  so_no: string | null;
}

export interface PackagingScheduleResult {
  from: string;
  to: string;
  lines: PackagingLine[];
  cells: PackagingCell[];
  /** `${line_key}|${YYYY-MM-DD}` → 그 라인·날짜 실제 포장 수량(일일작업현황 양품수량 합) */
  actuals: Record<string, number>;
}

export function ensurePackagingScheduleTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS packaging_schedule (
      plan_date TEXT NOT NULL,
      line_key TEXT NOT NULL,
      product_name TEXT,
      plan_qty REAL,
      pack_size TEXT,
      customer TEXT,
      due_date TEXT,
      so_no TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_by TEXT,
      PRIMARY KEY (plan_date, line_key)
    )
  `);
}

export function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

export function fetchPackagingSchedule(db: DatabaseSync, from: string, days: number): PackagingScheduleResult {
  ensurePackagingScheduleTable(db);
  const to = addDays(from, days - 1);
  const cells = db
    .prepare(
      `SELECT plan_date, line_key, product_name, plan_qty, pack_size, customer, due_date, so_no
       FROM packaging_schedule WHERE plan_date BETWEEN ? AND ? ORDER BY plan_date, line_key`
    )
    .all(from, to) as unknown as PackagingCell[];

  // 실적 — 일일작업현황의 출하포장(P410) 양품수량을 포장 라인·일자별로 합산
  const actualRows = db
    .prepare(
      `SELECT work_date d, json_extract(detail, '$."라인"') l,
              SUM(CAST(json_extract(detail, '$."양품수량"') AS REAL)) q
       FROM daily_work_status
       WHERE process_code = 'P410' AND work_date BETWEEN ? AND ?
       GROUP BY work_date, l`
    )
    .all(from, to) as { d: string; l: string | null; q: number | null }[];
  const lineByActualName = new Map<string, string>();
  for (const line of PACKAGING_LINES) for (const n of line.actualLines) lineByActualName.set(n, line.key);
  const actuals: Record<string, number> = {};
  for (const r of actualRows) {
    const key = lineByActualName.get(r.l ?? "");
    if (!key) continue;
    const k = `${key}|${r.d}`;
    actuals[k] = (actuals[k] ?? 0) + (r.q ?? 0);
  }
  return { from, to, lines: PACKAGING_LINES, cells, actuals };
}

function cleanText(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s.slice(0, max);
}

/** 한 칸(라인·일자)의 일부 필드를 저장한다 — 보낸 필드만 갱신하고, 모든 필드가 비면 행을 지운다 */
export function upsertPackagingCell(
  db: DatabaseSync,
  planDate: string,
  lineKey: string,
  fields: Partial<Record<PackagingField, unknown>>,
  user: string | null
): void {
  ensurePackagingScheduleTable(db);
  const current = db
    .prepare(
      `SELECT product_name, plan_qty, pack_size, customer, due_date, so_no
       FROM packaging_schedule WHERE plan_date = ? AND line_key = ?`
    )
    .get(planDate, lineKey) as
    | { product_name: string | null; plan_qty: number | null; pack_size: string | null; customer: string | null; due_date: string | null; so_no: string | null }
    | undefined;
  const next = {
    product_name: current?.product_name ?? null,
    plan_qty: current?.plan_qty ?? null,
    pack_size: current?.pack_size ?? null,
    customer: current?.customer ?? null,
    due_date: current?.due_date ?? null,
    so_no: current?.so_no ?? null,
  };
  if ("product_name" in fields) next.product_name = cleanText(fields.product_name, 100);
  if ("pack_size" in fields) next.pack_size = cleanText(fields.pack_size, 30);
  if ("customer" in fields) next.customer = cleanText(fields.customer, 100);
  if ("so_no" in fields) next.so_no = cleanText(fields.so_no, 40);
  if ("due_date" in fields) {
    const s = cleanText(fields.due_date, 10);
    next.due_date = s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  if ("plan_qty" in fields) {
    const raw = fields.plan_qty;
    if (raw == null || raw === "") next.plan_qty = null;
    else {
      const n = Number(String(raw).replace(/,/g, ""));
      next.plan_qty = Number.isFinite(n) && n >= 0 ? n : null;
    }
  }
  const empty = Object.values(next).every((v) => v == null);
  if (empty) {
    db.prepare("DELETE FROM packaging_schedule WHERE plan_date = ? AND line_key = ?").run(planDate, lineKey);
    return;
  }
  db.prepare(
    `INSERT INTO packaging_schedule (plan_date, line_key, product_name, plan_qty, pack_size, customer, due_date, so_no, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?)
     ON CONFLICT(plan_date, line_key) DO UPDATE SET
       product_name = excluded.product_name, plan_qty = excluded.plan_qty, pack_size = excluded.pack_size,
       customer = excluded.customer, due_date = excluded.due_date, so_no = excluded.so_no,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).run(planDate, lineKey, next.product_name, next.plan_qty, next.pack_size, next.customer, next.due_date, next.so_no, user);
}

export interface PackagingOrderInfo {
  so_no: string;
  customer: string | null;
  product_name: string | null;
  pack_size: string | null;
  due_date: string | null;
  order_qty: number;
}

/**
 * 수주번호로 수주현황에서 고객사·품명·개입수·납기일을 찾아온다. 수주현황의 수주번호는 품목 줄마다
 * "SO202609030001-1"처럼 순번이 붙어 있어, 입력한 번호와 같거나 그 번호로 시작하는 줄을 모아 쓴다.
 */
export function lookupOrderInfo(db: DatabaseSync, soNoRaw: string): PackagingOrderInfo | null {
  const soNo = soNoRaw.trim();
  if (!soNo) return null;
  const rows = db
    .prepare(
      `SELECT order_qty, due_date,
              json_extract(detail, '$."거래처명"') cname, json_extract(detail, '$."품목정보"') info,
              json_extract(detail, '$."품목군"') grp
       FROM sales_orders WHERE so_no = ? OR so_no LIKE ? ORDER BY so_no LIMIT 500`
    )
    .all(soNo, `${soNo.replace(/[%_]/g, "")}-%`) as {
    order_qty: number | null;
    due_date: string | null;
    cname: string | null;
    info: string | null;
    grp: string | null;
  }[];
  if (rows.length === 0) return null;
  const first = rows[0];
  const info = first.info ?? "";
  const nameFromInfo = info.split("◆")[0].trim();
  const pack = /(\d+)\s*개입/.exec(info) ?? /\((\d+)\s*P/i.exec(info);
  return {
    so_no: soNo,
    customer: first.cname,
    product_name: nameFromInfo || first.grp,
    pack_size: pack ? pack[1] : null,
    due_date: rows.map((r) => r.due_date).filter((d): d is string => !!d).sort()[0] ?? null,
    order_qty: rows.reduce((s, r) => s + (r.order_qty ?? 0), 0),
  };
}
