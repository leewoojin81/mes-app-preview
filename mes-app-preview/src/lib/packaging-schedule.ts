import type { DatabaseSync } from "node:sqlite";

// 계획정보(PLAN-03) "출하포장" — 포장 라인별·일자별 포장 계획표("2026년 포장_20261001.xlsx" 1번 시트)를
// 그대로 옮긴 화면의 데이터. 라인(1~5 Line/바이알) × 날짜 한 칸에 수주번호만 직접 입력하고, 고객사(약칭)·품목군·
// 계획(수량)·개입수·납기일은 그 수주번호로 수주등록(SALES-02)·거래처정보(BASE-06)·제품정보(BASE-01)에서 읽어 온다
// (2026-10-02 사용자 요청 — 수주번호 외에는 수기 입력하지 않는다). 읽을 때마다 최신 값으로 다시 찾으므로 수주
// 수량·납기일이나 거래처 약칭이 바뀌면 자동으로 따라가고, 저장된 값은 수주를 찾지 못할 때의 예비값이다. 실적은
// 일일작업현황(PROD-10)의 출하포장 공정 중 수주번호가 같은 줄의 양품수량을 실제 포장한 날짜별로 붙인다.

export interface PackagingLine {
  key: string;
  label: string;
  sub: string;
}

export const PACKAGING_LINES: PackagingLine[] = [
  { key: "line1", label: "1 Line", sub: "Auto (Monthly)" },
  { key: "line2", label: "2 Line", sub: "Auto (One day)" },
  { key: "line3", label: "3 Line", sub: "Auto (Monthly)" },
  { key: "line4", label: "4 Line", sub: "Manual (Conveyor)" },
  { key: "line5", label: "5 Line", sub: "Manual (Conveyor)" },
  { key: "vial", label: "바이알", sub: "" },
];

// pack_method(팩방법)는 제품정보(BASE-01) 포장방법을 읽어 보여주기만 하는 값이라 DB에는 저장하지 않는다
export const PACKAGING_FIELDS = ["product_name", "plan_qty", "pack_size", "customer", "due_date", "so_no", "pack_method"] as const;
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
  /** 수주량 — 수주번호의 수주 수량 합계(저장하지 않고 수주등록에서 읽어 온다) */
  order_qty?: number | null;
  /** 팩방법 — 제품정보(BASE-01) 포장방법(저장하지 않고 수주번호로 읽어 온다) */
  pack_method: string | null;
}

/** 한 라인·한 날짜의 실적 — 그 라인에 계획한 수주번호들의 그날 출하포장 양품수량 */
export interface PackagingDayActual {
  total: number;
  details: { so: string; line: string; qty: number }[];
}

/** 수주번호 칸 문자열에서 번호들을 뽑는다(쉼표·공백·슬래시·세미콜론 구분) */
export function splitSoNos(raw: string | null | undefined): string[] {
  return [...new Set((raw ?? "").split(/[\s,;/]+/).map((t) => t.trim()).filter(Boolean))];
}

export interface PackagingScheduleResult {
  from: string;
  to: string;
  lines: PackagingLine[];
  /** 수주번호로 읽어 온 값이 채워진 계획 칸(수주를 못 찾으면 저장된 예비값) */
  cells: PackagingCell[];
  /**
   * `${line_key}|${YYYY-MM-DD}` → 실적. 일일작업현황(PROD-10)에서 공정이 출하포장(P410)이고 수주번호가 그 라인의
   * 계획에 들어 있는 수주번호와 같은 줄의 양품수량을 **실제 포장한 날짜**별로 모은다 — 계획 대비 실적이라 계획과
   * 같은 날짜 열에 맞춰 보여준다(2026-10-02 사용자 요청).
   */
  lineActuals: Record<string, PackagingDayActual>;
  /** 수주번호 → 표시 시작일 **이전**에 포장한 실적 합계(누적 진도율이 시작일 전 실적도 포함하도록) */
  soPriorActual: Record<string, number>;
  /** 표시 기간 계획 칸에 적힌 수주번호 중 수주등록(SALES-02)에 없는 번호 — 화면이 색으로 오류 표기한다 */
  missingSoNos: string[];
  /**
   * 생산캘린더(BASE-08) 기준 휴일(day_type=휴일) 날짜와 근무일(day_type=평일) 날짜. 화면이 칸 색을 정한다 —
   * 캘린더 휴일인 평일과 캘린더상 근무일인 일요일은 토요일과 같은 색으로, 휴일인 일요일은 일요일 색으로 칠한다
   * (2026-10-02 사용자 요청).
   */
  holidays: string[];
  workDays: string[];
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

// ── 수주번호로 값 읽어 오기 ──────────────────────────────────────────────────────

export interface PackagingOrderInfo {
  customer: string | null;
  /** 품목군(수주등록 SALES-02 품목군) */
  product_name: string | null;
  /** 개입수 — 제품정보(BASE-01) 포장단위수량 */
  pack_size: string | null;
  due_date: string | null;
  /** 팩방법 — 제품정보(BASE-01) 포장방법 */
  pack_method: string | null;
  /** 계획(수량) — 그 수주번호의 수주 수량 합계 */
  order_qty: number;
}

interface OrderRow {
  so_no: string;
  item_code: string | null;
  order_qty: number | null;
  due_date: string | null;
  cname: string | null;
  info: string | null;
  grp: string | null;
  pk: number | string | null;
  pm: string | null;
  dso: string | null;
}

function soBase(soNo: string): string {
  const i = soNo.indexOf("-");
  return i > 0 ? soNo.slice(0, i) : soNo;
}

/**
 * 수주번호들에 해당하는 수주등록(SALES-02) 줄을 한 번에 찾는다. 수주 테이블의 so_no는 품목 줄마다
 * "SO202609030001-1"처럼 순번이 붙어 있고 원본 "수주번호" 컬럼에는 순번 없는 번호가 있어, 입력한 번호가
 * so_no(순번 앞부분)나 원본 수주번호와 같은 줄을 모두 모은다. 고객사는 거래처정보(BASE-06)의 약칭을 우선하고
 * 없으면 수주의 거래처명, 개입수는 제품정보(BASE-01)의 포장단위수량이다. 못 찾은 번호는 결과에 키가 없다.
 */
function fetchOrderRowsByTokens(db: DatabaseSync, tokens: string[]): Map<string, OrderRow[]> {
  const result = new Map<string, OrderRow[]>();
  const wanted = new Set(tokens);
  for (let k = 0; k < tokens.length; k += 200) {
    const chunk = tokens.slice(k, k + 200);
    const ph = chunk.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT so.so_no, so.item_code, so.order_qty, so.due_date,
                COALESCE(NULLIF(TRIM(cu.short_name), ''), json_extract(so.detail, '$."거래처명"')) cname,
                json_extract(so.detail, '$."품목정보"') info,
                json_extract(so.detail, '$."품목군"') grp,
                json_extract(it.detail, '$."포장단위수량"') pk,
                json_extract(it.detail, '$."포장방법"') pm,
                json_extract(so.detail, '$."수주번호"') dso
         FROM sales_orders so
         LEFT JOIN items it ON it.item_code = so.item_code
         LEFT JOIN customers cu ON cu.customer_code = so.customer_code
         WHERE substr(so.so_no, 1, CASE WHEN instr(so.so_no, '-') > 0 THEN instr(so.so_no, '-') - 1 ELSE length(so.so_no) END) IN (${ph})
            OR json_extract(so.detail, '$."수주번호"') IN (${ph})
         ORDER BY so.so_no`
      )
      .all(...chunk, ...chunk) as unknown as OrderRow[];
    for (const r of rows) {
      for (const key of new Set([r.so_no, soBase(r.so_no), r.dso ?? ""])) {
        if (!key || !wanted.has(key)) continue;
        const list = result.get(key) ?? [];
        list.push(r);
        result.set(key, list);
      }
    }
  }
  return result;
}

/**
 *  - 품목군: 첫 줄의 품목군 / 납기일: 가장 빠른 납기일 / 계획(수량): 수주 수량 합계
 *  - 개입수: 줄마다 품목코드로 제품정보의 "포장단위수량"을 찾아 수량이 가장 많은 값(없으면 수주 품목정보의 "N개입")
 */
function summarizeOrder(rows: OrderRow[]): PackagingOrderInfo {
  const first = rows[0];
  const packWeight = new Map<string, number>();
  for (const r of rows) {
    const v = r.pk != null && Number(r.pk) > 0 ? String(Number(r.pk)) : null;
    if (v) packWeight.set(v, (packWeight.get(v) ?? 0) + (r.order_qty ?? 0) + 1);
  }
  let pack: string | null = null;
  let best = -1;
  for (const [v, w] of packWeight) {
    if (w > best) {
      best = w;
      pack = v;
    }
  }
  if (!pack) {
    const m = /(\d+)\s*개입/.exec(first.info ?? "") ?? /\((\d+)\s*P/i.exec(first.info ?? "");
    pack = m ? m[1] : null;
  }
  // 팩방법 — 제품정보 포장방법 값별 수주 수량 합이 가장 큰 값
  const methodWeight = new Map<string, number>();
  for (const r of rows) {
    const m = (r.pm ?? "").trim();
    if (m) methodWeight.set(m, (methodWeight.get(m) ?? 0) + (r.order_qty ?? 0) + 1);
  }
  let method: string | null = null;
  let bestMethod = -1;
  for (const [v, w] of methodWeight) {
    if (w > bestMethod) {
      bestMethod = w;
      method = v;
    }
  }
  return {
    customer: first.cname,
    product_name: first.grp ?? ((first.info ?? "").split("◆")[0].trim() || null),
    pack_method: method,
    pack_size: pack,
    due_date: rows.map((r) => r.due_date).filter((x): x is string => !!x).sort()[0] ?? null,
    order_qty: rows.reduce((sum, r) => sum + (r.order_qty ?? 0), 0),
  };
}

/**
 * 한 칸에 수주번호가 여러 개(예: "Dope Wink 2종" = SO202609150008, SO202609150009)이면 합친다:
 * 고객사·품목군은 서로 다른 값을 ", "로, 개입수는 서로 다른 값을 작은 수부터 ","로(예: "1,2"),
 * 납기일은 가장 빠른 날짜, 계획은 수량 합계.
 */
function combineOrderInfos(infos: PackagingOrderInfo[]): PackagingOrderInfo {
  if (infos.length === 1) return infos[0];
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  return {
    customer: uniq(infos.map((f) => f.customer)).join(", ") || null,
    product_name: uniq(infos.map((f) => f.product_name)).join(", ") || null,
    pack_size: uniq(infos.map((f) => f.pack_size)).sort((a, b) => Number(a) - Number(b)).join(",") || null,
    pack_method: uniq(infos.map((f) => f.pack_method)).join(", ") || null,
    due_date: infos.map((f) => f.due_date).filter((x): x is string => !!x).sort()[0] ?? null,
    order_qty: infos.reduce((sum, f) => sum + f.order_qty, 0),
  };
}

/** 수주번호 칸 문자열 하나에서 값을 읽어 온다(번호가 여러 개면 합침). 하나도 못 찾으면 null */
export function lookupOrderInfo(db: DatabaseSync, soNoRaw: string): PackagingOrderInfo | null {
  const tokens = splitSoNos(soNoRaw);
  if (tokens.length === 0) return null;
  const map = fetchOrderRowsByTokens(db, tokens);
  const infos = tokens
    .map((t) => map.get(t))
    .filter((rows): rows is OrderRow[] => !!rows)
    .map(summarizeOrder);
  return infos.length > 0 ? combineOrderInfos(infos) : null;
}

// ── 조회 ─────────────────────────────────────────────────────────────────────────

/** 라인(line1~) → 포장기 UPH·하루 작업시간 — 설비정보(BASE-05) Packing 설비군의 "N호기" 설비 */
function loadCapaByLine(db: DatabaseSync): Map<string, { uph: number; hours: number }> {
  const capaByLine = new Map<string, { uph: number; hours: number }>();
  const pkRows = db
    .prepare(
      `SELECT equipment_name, uph, daily_work_minutes FROM equipments
        WHERE equipment_group = 'Packing' AND COALESCE(use_yn, 'Y') = 'Y' ORDER BY equipment_id`
    )
    .all() as { equipment_name: string; uph: number | null; daily_work_minutes: number | null }[];
  for (const e of pkRows) {
    const m = /(\d+)\s*호기/.exec(e.equipment_name ?? "");
    if (!m) continue;
    const key = `line${Number(m[1])}`;
    if (capaByLine.has(key)) continue;
    const uph = Number(e.uph) || 0;
    const hours = (Number(e.daily_work_minutes) || 0) / 60;
    if (uph > 0 && hours > 0) capaByLine.set(key, { uph, hours });
  }
  return capaByLine;
}

export function fetchPackagingSchedule(db: DatabaseSync, from: string, days: number): PackagingScheduleResult {
  ensurePackagingScheduleTable(db);
  const to = addDays(from, days - 1);
  const cells = db
    .prepare(
      `SELECT plan_date, line_key, product_name, plan_qty, pack_size, customer, due_date, so_no
       FROM packaging_schedule WHERE plan_date BETWEEN ? AND ? ORDER BY plan_date, line_key`
    )
    .all(from, to)
    .map((c) => ({ ...(c as unknown as Omit<PackagingCell, "pack_method">), pack_method: null }))
    // 수주번호가 없는 칸은 보여주지 않는다 — 수주번호 외의 값은 직접 입력하지 않고 수주번호로만 채우기 때문에
    // (2026-10-02 사용자 요청) 예전에 값만 남아 있는 칸(엑셀에서 가져온 이어지는 작업일 등)이 있어도 숨긴다.
    .filter((c) => splitSoNos(c.so_no).length > 0) as PackagingCell[];

  // 수주번호 → 그 수주를 계획한 라인 — 전체 계획(표시 기간 밖 포함)에서 가장 이른 계획의 라인으로 정한다.
  // 같은 수주가 실제로는 다른 포장기에서 작업돼도 계획한 라인의 실적으로 본다.
  const planned = db
    .prepare("SELECT line_key, so_no FROM packaging_schedule WHERE so_no IS NOT NULL ORDER BY plan_date, line_key")
    .all() as { line_key: string; so_no: string }[];
  const lineBySo = new Map<string, string>();
  for (const r of planned) for (const so of splitSoNos(r.so_no)) if (!lineBySo.has(so)) lineBySo.set(so, r.line_key);

  const lineActuals: Record<string, PackagingDayActual> = {};
  const soPriorActual: Record<string, number> = {};
  const soNos = [...lineBySo.keys()];
  for (let k = 0; k < soNos.length; k += 200) {
    const chunk = soNos.slice(k, k + 200);
    const ph = chunk.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT json_extract(detail, '$."수주번호"') so, work_date d, json_extract(detail, '$."라인"') l,
                SUM(CAST(json_extract(detail, '$."양품수량"') AS REAL)) q
         FROM daily_work_status
         WHERE process_code = 'P410' AND work_date BETWEEN ? AND ? AND json_extract(detail, '$."수주번호"') IN (${ph})
         GROUP BY so, work_date, l ORDER BY work_date, so`
      )
      .all(from, to, ...chunk) as { so: string; d: string; l: string | null; q: number | null }[];
    const priorRows = db
      .prepare(
        `SELECT json_extract(detail, '$."수주번호"') so, SUM(CAST(json_extract(detail, '$."양품수량"') AS REAL)) q
         FROM daily_work_status
         WHERE process_code = 'P410' AND work_date < ? AND json_extract(detail, '$."수주번호"') IN (${ph})
         GROUP BY so`
      )
      .all(from, ...chunk) as { so: string; q: number | null }[];
    for (const r of priorRows) soPriorActual[r.so] = (soPriorActual[r.so] ?? 0) + (r.q ?? 0);
    for (const r of rows) {
      const lineKey = lineBySo.get(r.so);
      if (!lineKey) continue;
      const a = (lineActuals[`${lineKey}|${r.d}`] ??= { total: 0, details: [] });
      const qty = r.q ?? 0;
      a.total += qty;
      a.details.push({ so: r.so, line: r.l ?? "", qty });
    }
  }

  // 수주번호로 값 읽어 오기 — 칸에 적힌 수주번호들을 한 번에 찾아 고객사·품목군·계획·개입수·납기일을 채우고,
  // 수주등록에 없는 번호는 missingSoNos로 돌려준다(저장된 값은 못 찾았을 때의 예비값으로 그대로 둔다).
  const tokens = [...new Set(cells.flatMap((c) => splitSoNos(c.so_no)))];
  const orderMap = fetchOrderRowsByTokens(db, tokens);
  const missingSoNos = tokens.filter((t) => !orderMap.has(t));
  // 계획 = 포장기 UPH × 하루 작업시간 × 개입수 (2026-10-02 사용자 요청). 라인 N은 설비정보(BASE-05) Packing 설비군의 "N호기"
  // 설비를 쓴다 — 예) UPH 1500 × 8시간(일취업시간 480분) × 개입수 10 = 120,000. UPH·개입수가 없으면 계획은 비워 둔다.
  const cellPlans = allocateCellPlans(db).cellPlan;
  const filledCells = cells.map((c) => {
    const infos = splitSoNos(c.so_no)
      .map((t) => orderMap.get(t))
      .filter((rows): rows is OrderRow[] => !!rows)
      .map(summarizeOrder);
    if (infos.length === 0) return c;
    const merged = combineOrderInfos(infos);
    const planned = cellPlans.get(`${c.plan_date}|${c.line_key}`);
    return {
      ...c,
      customer: merged.customer ?? c.customer,
      product_name: merged.product_name ?? c.product_name,
      plan_qty: planned && planned > 0 ? planned : null,
      order_qty: merged.order_qty > 0 ? merged.order_qty : null,
      pack_size: merged.pack_size ?? c.pack_size,
      pack_method: merged.pack_method,
      due_date: merged.due_date ?? c.due_date,
    };
  });
  const calRows = db
    .prepare("SELECT cal_date, day_type FROM production_calendar WHERE cal_date BETWEEN ? AND ? ORDER BY cal_date")
    .all(from, to) as { cal_date: string; day_type: string }[];
  const holidays = calRows.filter((r) => r.day_type === "휴일").map((r) => r.cal_date);
  const workDays = calRows.filter((r) => r.day_type === "평일").map((r) => r.cal_date);
  return { from, to, lines: PACKAGING_LINES, cells: filledCells, lineActuals, soPriorActual, missingSoNos, holidays, workDays };
}

// ── 저장 ─────────────────────────────────────────────────────────────────────────

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
    | {
        product_name: string | null;
        plan_qty: number | null;
        pack_size: string | null;
        customer: string | null;
        due_date: string | null;
        so_no: string | null;
      }
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
  if ("so_no" in fields) next.so_no = cleanText(fields.so_no, 80);
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

/**
 * 수주번호 한 칸을 저장한다 — 번호만 직접 입력하는 칸이다(2026-10-02). 저장할 때 읽어 온 값을 예비값으로 같이
 * 저장해 두고(수주를 못 찾으면 이전 값을 그대로 둔다), 번호를 지우면 읽어 왔던 값도 함께 비운다.
 */
export function savePackagingSoNo(
  db: DatabaseSync,
  planDate: string,
  lineKey: string,
  soNoRaw: string,
  user: string | null
): void {
  const soNo = cleanText(soNoRaw, 80);
  if (!soNo) {
    upsertPackagingCell(
      db,
      planDate,
      lineKey,
      { so_no: null, product_name: null, plan_qty: null, pack_size: null, customer: null, due_date: null },
      user
    );
    return;
  }
  const info = lookupOrderInfo(db, soNo);
  upsertPackagingCell(
    db,
    planDate,
    lineKey,
    info
      ? {
          so_no: soNo,
          customer: info.customer,
          product_name: info.product_name,
          plan_qty: info.order_qty > 0 ? info.order_qty : null,
          pack_size: info.pack_size,
          due_date: info.due_date,
        }
      : { so_no: soNo },
    user
  );
}

// ── 라인별 포장 가능 수주 후보 ───────────────────────────────────────────────────────

export interface PackagingCandidate {
  so_no: string;
  customer: string | null;
  product_group: string | null;
  order_qty: number;
  /** 이미 포장한 양(PROD-10 출하포장 양품수량 누계 — 칸 날짜가 주어지면 그 날짜 **전날까지**의 실적) */
  packed_qty: number;
  due_date: string | null;
  pack_method: string | null;
}

/**
 * 라인이 처리할 수 있는 포장방법(2026-10-02 사용자 선택: 포장방법으로 구분) — 2 Line(원데이)은 원데이·원데이(보석),
 * 바이알은 바이알, 나머지 라인(1·3 먼슬리, 4·5 수동)은 그 둘을 뺀 포장방법(비어 있으면 포함)이다.
 */
function lineAcceptsMethod(lineKey: string, pm: string | null): boolean {
  const m = (pm ?? "").trim();
  const oneDay = m.startsWith("원데이");
  if (lineKey === "line2") return oneDay;
  if (lineKey === "vial") return m === "바이알";
  return !oneDay && m !== "바이알";
}

/**
 * 그 라인에서 포장할 수 있는 수주 후보 — 납기일이 이른 순. 수주번호(수주등록 "수주번호") 단위로 묶어 수량을 합하고,
 * 이미 포장한 양이 수주량 이상이거나 일정에 계획이 수주량만큼 이미 잡힌 수주, MO-번호가 없는 줄, (주)메디오스 수주는 뺀다. 납기가 `sinceDue`보다 이전이면 오래된 수주로 보고 뺀다.
 */
export function fetchPackagingCandidates(
  db: DatabaseSync,
  lineKey: string,
  sinceDue: string,
  exceptCell?: { date: string; line: string },
  limit = 300
): PackagingCandidate[] {
  const rows = db
    .prepare(
      `SELECT COALESCE(NULLIF(json_extract(so.detail, '$."수주번호"'), ''),
                       substr(so.so_no, 1, CASE WHEN instr(so.so_no, '-') > 0 THEN instr(so.so_no, '-') - 1 ELSE length(so.so_no) END)) sono,
              MAX(COALESCE(NULLIF(TRIM(cu.short_name), ''), json_extract(so.detail, '$."거래처명"'))) cname,
              MAX(json_extract(so.detail, '$."품목군"')) grp,
              SUM(so.order_qty) qty,
              MIN(so.due_date) due,
              MAX(json_extract(it.detail, '$."포장방법"')) pm
         FROM sales_orders so
         LEFT JOIN items it ON it.item_code = so.item_code
         LEFT JOIN customers cu ON cu.customer_code = so.customer_code
        WHERE so.due_date >= ?
          -- 수주등록(SALES-02)에서 MO-번호가 없는 줄과 (주)메디오스 거래처는 후보에서 뺀다(2026-10-02 사용자 요청)
          AND TRIM(COALESCE(json_extract(so.detail, '$."MO-번호"'), '')) <> ''
          AND REPLACE(COALESCE(json_extract(so.detail, '$."거래처명"'), ''), ' ', '') <> '(주)메디오스'
        GROUP BY sono
        ORDER BY due, sono`
    )
    .all(sinceDue) as { sono: string; cname: string | null; grp: string | null; qty: number | null; due: string | null; pm: string | null }[];
  const eligible = rows.filter((r) => r.sono && lineAcceptsMethod(lineKey, r.pm));
  const packed = new Map<string, number>();
  for (let k = 0; k < eligible.length; k += 200) {
    const chunk = eligible.slice(k, k + 200).map((r) => r.sono);
    const ph = chunk.map(() => "?").join(",");
    const prows = db
      .prepare(
        `SELECT json_extract(detail, '$."수주번호"') so, SUM(CAST(json_extract(detail, '$."양품수량"') AS REAL)) q
           FROM daily_work_status
          WHERE process_code = 'P410' AND json_extract(detail, '$."수주번호"') IN (${ph})
            ${exceptCell ? "AND work_date < ?" : ""}
          GROUP BY so`
      )
      .all(...chunk, ...(exceptCell ? [exceptCell.date] : [])) as { so: string; q: number | null }[];
    for (const p of prows) packed.set(p.so, p.q ?? 0);
  }
  const remainingAfter = allocateCellPlans(
    db,
    exceptCell ? (d, l) => d === exceptCell.date && l === exceptCell.line : undefined
  ).remainingAfter;
  const out: PackagingCandidate[] = [];
  for (const r of eligible) {
    const qty = r.qty ?? 0;
    const done = packed.get(r.sono) ?? 0;
    if (qty > 0 && done >= qty) continue;
    // 수주량만큼 일정에 계획이 이미 잡힌 수주는 뺀다(2026-10-02 사용자 요청)
    if (qty > 0 && remainingAfter.has(r.sono) && (remainingAfter.get(r.sono) ?? 0) <= 0) continue;
    out.push({ so_no: r.sono, customer: r.cname, product_group: r.grp, order_qty: qty, packed_qty: done, due_date: r.due, pack_method: r.pm });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 일정(packaging_schedule)의 칸별 계획을 계산한다(2026-10-02 사용자 요청) — 칸의 하루 계획은 포장기 UPH × 작업시간 × 개입수이지만
 * 수주의 남은 양을 넘지는 않는다. 수주별 남은 양은 처음 계획된 날짜 **전날까지**의 포장 실적을 뺀 수주량에서 시작해, 날짜 순으로
 * 칸마다 줄어든다(예: 잔량 486,000 · 하루 240,000 → 240,000 · 240,000 · 6,000). 한 칸에 수주번호가 여러 개면 적힌 순서대로
 * 각 수주의 남은 양까지 채워 나눈다. skip은 계산에서 뺄 칸(지금 고치고 있는 칸 등)이다.
 * remainingAfter는 계획에 한 번이라도 나온 수주의 남은 양 — 0 이하면 이미 다 계획된 수주다.
 */
function allocateCellPlans(
  db: DatabaseSync,
  skip?: (date: string, line: string) => boolean
): { cellPlan: Map<string, number>; remainingAfter: Map<string, number> } {
  const capa = loadCapaByLine(db);
  const cells = db
    .prepare("SELECT plan_date, line_key, so_no FROM packaging_schedule WHERE so_no IS NOT NULL AND TRIM(so_no) <> '' ORDER BY plan_date, line_key")
    .all() as { plan_date: string; line_key: string; so_no: string }[];
  const tokens = [...new Set(cells.flatMap((c) => splitSoNos(c.so_no)))];
  const orderMap = fetchOrderRowsByTokens(db, tokens);
  const packedStmt = db.prepare(
    `SELECT SUM(CAST(json_extract(detail, '$."양품수량"') AS REAL)) q FROM daily_work_status
      WHERE process_code = 'P410' AND json_extract(detail, '$."수주번호"') = ? AND work_date < ?`
  );
  const remaining = new Map<string, number>();
  const cellPlan = new Map<string, number>();
  for (const c of cells) {
    if (skip?.(c.plan_date, c.line_key)) continue;
    const toks = splitSoNos(c.so_no);
    const infos = toks
      .map((t) => orderMap.get(t))
      .filter((rows): rows is OrderRow[] => !!rows)
      .map(summarizeOrder);
    if (infos.length === 0) continue;
    for (const t of toks) {
      const rows = orderMap.get(t);
      if (rows && !remaining.has(t)) {
        const packed = (packedStmt.get(t, c.plan_date) as { q: number | null } | undefined)?.q ?? 0;
        remaining.set(t, rows.reduce((sum, r) => sum + (r.order_qty ?? 0), 0) - packed);
      }
    }
    const cap = capa.get(c.line_key);
    const merged = combineOrderInfos(infos);
    const pn = merged.pack_size && /^\d+$/.test(merged.pack_size.trim()) ? Number(merged.pack_size) : 0;
    if (!cap || pn <= 0) continue;
    let left = Math.round(cap.uph * cap.hours * pn);
    let total = 0;
    for (const t of toks) {
      if (left <= 0) break;
      const room = Math.max(0, remaining.get(t) ?? 0);
      const take = Math.min(left, room);
      remaining.set(t, (remaining.get(t) ?? 0) - take);
      left -= take;
      total += take;
    }
    cellPlan.set(`${c.plan_date}|${c.line_key}`, total);
  }
  return { cellPlan, remainingAfter: remaining };
}

export interface AutoFillResult {
  /** 수주번호별로 배정한 날짜들 */
  filled: { so_no: string; dates: string[] }[];
  /** 계획을 계산하지 못해(UPH·개입수 없음) 시작 칸 하나만 넣은 수주번호 */
  singleOnly: string[];
  /** 수주등록에서 못 찾은 수주번호 */
  missing: string[];
}

/**
 * 수주번호의 잔량이 다 계획될 때까지 시작일부터 근무일마다 그 라인 칸에 자동으로 넣는다(2026-10-02 사용자 요청).
 * 잔량 = 수주량 − 시작일 전날까지의 포장 실적 − 그 수주가 시작일 이후 이 라인 밖/이전에 이미 잡힌 계획.
 * 하루 계획은 포장기 UPH × 작업시간 × 개입수이고, 생산캘린더(BASE-08)의 휴일(주말·공휴일)은 건너뛰며, 이미 다른 수주가
 * 들어 있는 칸은 건드리지 않고 건너뛴다. 여러 수주번호면 적힌 순서대로 이어서 채운다.
 */
export function autoFillPackagingSoNos(
  db: DatabaseSync,
  startDate: string,
  lineKey: string,
  soNos: string[],
  user: string | null
): AutoFillResult {
  const result: AutoFillResult = { filled: [], singleOnly: [], missing: [] };
  const cap = loadCapaByLine(db).get(lineKey);
  const holidaySet = new Set(
    (db.prepare("SELECT cal_date FROM production_calendar WHERE day_type = '휴일' AND cal_date >= ?").all(startDate) as { cal_date: string }[]).map(
      (r) => r.cal_date
    )
  );
  const workSet = new Set(
    (db.prepare("SELECT cal_date FROM production_calendar WHERE day_type = '평일' AND cal_date >= ?").all(startDate) as { cal_date: string }[]).map(
      (r) => r.cal_date
    )
  );
  const isOff = (d: string): boolean => {
    if (holidaySet.has(d)) return true;
    if (workSet.has(d)) return false;
    const [y, m, dd] = d.split("-").map(Number);
    const wd = new Date(y, m - 1, dd).getDay();
    return wd === 0 || wd === 6; // 캘린더에 없는 날은 주말만 쉬는 날로 본다
  };
  const occupied = new Map(
    (
      db
        .prepare("SELECT plan_date, so_no FROM packaging_schedule WHERE line_key = ? AND plan_date >= ? AND so_no IS NOT NULL AND TRIM(so_no) <> ''")
        .all(lineKey, startDate) as { plan_date: string; so_no: string }[]
    ).map((r) => [r.plan_date, r.so_no])
  );
  occupied.delete(startDate); // 시작 칸은 지금 고치는 칸이라 다른 수주가 있어도 바꾼다
  let cursor = startDate;
  for (const so of soNos) {
    const info = lookupOrderInfo(db, so);
    if (!info) {
      result.missing.push(so);
      continue;
    }
    const pn = info.pack_size && /^\d+$/.test(info.pack_size.trim()) ? Number(info.pack_size) : 0;
    const daily = cap && pn > 0 ? Math.round(cap.uph * cap.hours * pn) : 0;
    if (daily <= 0) {
      // 하루 계획을 못 구하면 시작 칸 하나만
      savePackagingSoNo(db, cursor, lineKey, so, user);
      result.singleOnly.push(so);
      result.filled.push({ so_no: so, dates: [cursor] });
      occupied.set(cursor, so);
      cursor = addDays(cursor, 1);
      continue;
    }
    const prow = db
      .prepare(
        `SELECT SUM(CAST(json_extract(detail, '$."양품수량"') AS REAL)) q FROM daily_work_status
          WHERE process_code = 'P410' AND json_extract(detail, '$."수주번호"') = ? AND work_date < ?`
      )
      .get(so, startDate) as { q: number | null } | undefined;
    // 이미 다른 칸(이 라인 시작일 이후는 제외)에서 계획돼 남은 양이 있으면 그것에서, 없으면 수주량 − 시작일 전날까지의 실적에서 시작
    const alloc = allocateCellPlans(db, (d, l) => l === lineKey && d >= startDate).remainingAfter;
    let remaining = alloc.has(so) ? (alloc.get(so) ?? 0) : info.order_qty - (prow?.q ?? 0);
    const dates: string[] = [];
    let guard = 0;
    while (remaining > 0 && guard++ < 120) {
      const cur = occupied.get(cursor);
      if (isOff(cursor) || (cur && cur !== so)) {
        cursor = addDays(cursor, 1);
        continue;
      }
      savePackagingSoNo(db, cursor, lineKey, so, user);
      occupied.set(cursor, so);
      dates.push(cursor);
      remaining -= daily;
      cursor = addDays(cursor, 1);
    }
    if (dates.length === 0) {
      // 잔량이 없어도 눌러서 고른 수주이므로 시작 칸에는 넣는다
      savePackagingSoNo(db, cursor, lineKey, so, user);
      occupied.set(cursor, so);
      dates.push(cursor);
      cursor = addDays(cursor, 1);
    }
    result.filled.push({ so_no: so, dates });
  }
  return result;
}
