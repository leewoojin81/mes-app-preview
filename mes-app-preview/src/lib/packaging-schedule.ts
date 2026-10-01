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
  /** 입력한 수주번호(여러 개면 입력한 그대로) */
  so_no: string;
  /** 수주등록에서 찾지 못한 번호 */
  missing?: string[];
  customer: string | null;
  /** 품목군(수주등록 SALES-02 품목군) */
  product_name: string | null;
  /** 포장단위수량(제품정보 BASE-01) */
  pack_size: string | null;
  due_date: string | null;
  /** 계획(수량) — 그 수주번호의 수주 수량 합계 */
  order_qty: number;
}

/**
 * 수주번호로 수주등록(SALES-02)에서 품목군·납기일·수량을, 제품정보(BASE-01)에서 포장단위수량을 찾아온다
 * (2026-10-01 사용자 요청). 수주 테이블의 so_no는 품목 줄마다 "SO202609030001-1"처럼 순번이 붙어 있어,
 * 입력한 번호와 같거나(원본 "수주번호" 컬럼 포함) 그 번호로 시작하는 줄을 모두 모아 쓴다.
 *  - 품목군: 첫 줄의 품목군 / 납기일: 가장 빠른 납기일 / 계획(수량): 수주 수량 합계
 *  - 포장단위수량: 줄마다 품목코드로 제품정보의 "포장단위수량"을 찾아 수량이 가장 많은 값을 쓴다
 *    (제품정보에 없으면 수주 품목정보의 "N개입"으로 대신한다)
 */
function lookupSingleOrder(db: DatabaseSync, soNoRaw: string): PackagingOrderInfo | null {
  const soNo = soNoRaw.trim();
  if (!soNo) return null;
  const rows = db
    .prepare(
      `SELECT so.item_code, so.order_qty, so.due_date,
              json_extract(so.detail, '$."거래처명"') cname, json_extract(so.detail, '$."품목정보"') info,
              json_extract(so.detail, '$."품목군"') grp,
              json_extract(it.detail, '$."포장단위수량"') pk
       FROM sales_orders so LEFT JOIN items it ON it.item_code = so.item_code
       WHERE so.so_no = ? OR so.so_no LIKE ? OR json_extract(so.detail, '$."수주번호"') = ?
       ORDER BY so.so_no LIMIT 2000`
    )
    .all(soNo, `${soNo.replace(/[%_]/g, "")}-%`, soNo) as {
    item_code: string | null;
    order_qty: number | null;
    due_date: string | null;
    cname: string | null;
    info: string | null;
    grp: string | null;
    pk: number | string | null;
  }[];
  if (rows.length === 0) return null;
  const first = rows[0];

  // 포장단위수량 — 제품정보 값별 수주 수량 합이 가장 큰 값
  const packWeight = new Map<string, number>();
  for (const r of rows) {
    const v = r.pk != null && Number(r.pk) > 0 ? String(Number(r.pk)) : null;
    if (v) packWeight.set(v, (packWeight.get(v) ?? 0) + (r.order_qty ?? 0) + 1);
  }
  let pack: string | null = null;
  let best = -1;
  for (const [v, w] of packWeight) if (w > best) { best = w; pack = v; }
  if (!pack) {
    const m = /(\d+)\s*개입/.exec(first.info ?? "") ?? /\((\d+)\s*P/i.exec(first.info ?? "");
    pack = m ? m[1] : null;
  }

  return {
    so_no: soNo,
    customer: first.cname,
    product_name: first.grp ?? ((first.info ?? "").split("◆")[0].trim() || null),
    pack_size: pack,
    due_date: rows.map((r) => r.due_date).filter((x): x is string => !!x).sort()[0] ?? null,
    order_qty: rows.reduce((sum, r) => sum + (r.order_qty ?? 0), 0),
  };
}

/**
 * 수주번호 칸에는 한 칸에 두 종 이상을 함께 포장하는 경우(예: "Dope Wink 2종") 수주번호를 여러 개 적을 수
 * 있다(쉼표·공백·슬래시로 구분, 2026-10-01 사용자 요청 — SO202609150008, SO202609150009). 번호마다 찾아
 *  - 품목군·고객사: 서로 다른 값을 ", "로 이어 붙이고
 *  - 납기일: 가장 빠른 날짜 / 계획(수량): 수량 합계
 *  - 포장단위수량: 서로 다른 값을 작은 수부터 ","로 이어 붙인다(예: "1,2").
 * 못 찾은 번호는 missing에 담아 돌려준다. 하나도 못 찾으면 null.
 */
export function lookupOrderInfo(db: DatabaseSync, soNoRaw: string): PackagingOrderInfo | null {
  const tokens = [...new Set(soNoRaw.split(/[\s,;/]+/).map((t) => t.trim()).filter(Boolean))];
  if (tokens.length === 0) return null;
  const found: PackagingOrderInfo[] = [];
  const missing: string[] = [];
  for (const t of tokens) {
    const info = lookupSingleOrder(db, t);
    if (info) found.push(info);
    else missing.push(t);
  }
  if (found.length === 0) return null;
  if (found.length === 1 && missing.length === 0) return found[0];
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const packs = uniq(found.map((f) => f.pack_size)).sort((a, b) => Number(a) - Number(b));
  return {
    so_no: soNoRaw.trim(),
    missing,
    customer: uniq(found.map((f) => f.customer)).join(", ") || null,
    product_name: uniq(found.map((f) => f.product_name)).join(", ") || null,
    pack_size: packs.join(",") || null,
    due_date: found.map((f) => f.due_date).filter((x): x is string => !!x).sort()[0] ?? null,
    order_qty: found.reduce((sum, f) => sum + f.order_qty, 0),
  };
}
