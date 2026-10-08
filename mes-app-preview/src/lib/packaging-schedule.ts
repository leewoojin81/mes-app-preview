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
  /** 수주량 표시용 — 그 수주번호가 일정에 처음 나오는 칸에만 값이 있다(2026-10-02 사용자 요청: 수주량은 최초 1번만 표기) */
  order_qty_first?: number | null;
  /** 팩방법 — 제품정보(BASE-01) 포장방법(저장하지 않고 수주번호로 읽어 온다) */
  pack_method: string | null;
  /** 팝업에서 계획수량을 직접 입력해 저장한 칸이면 true */
  plan_manual?: boolean;
  /** 직접 입력한 수주번호별 계획수량 */
  plan_by_so?: Record<string, number>;
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

// ── 출하포장(P410) 실적 한 번에 읽기 ─────────────────────────────────────────────────
// daily_work_status는 공정코드·수주번호에 인덱스가 없어 수주번호마다 따로 조회하면 일정 화면이 몇 초씩 걸린다. 출하포장 줄을
// 수주번호·일자·라인별로 한 번에 읽어(0.7초) 30초 동안 재사용하고, 이후 필터링은 메모리에서 한다.
interface P410Row {
  d: string;
  l: string;
  q: number;
}
const p410Cache = new WeakMap<DatabaseSync, { at: number; bySo: Map<string, P410Row[]> }>();
export function p410BySo(db: DatabaseSync): Map<string, P410Row[]> {
  const hit = p410Cache.get(db);
  if (hit && Date.now() - hit.at < 30_000) return hit.bySo;
  const rows = db
    .prepare(
      `SELECT json_extract(detail, '$."수주번호"') so, work_date d, json_extract(detail, '$."라인"') l,
              SUM(CAST(json_extract(detail, '$."양품수량"') AS REAL)) q
         FROM daily_work_status
        WHERE process_code = 'P410'
        GROUP BY so, work_date, l`
    )
    .all() as { so: string | null; d: string; l: string | null; q: number | null }[];
  const bySo = new Map<string, P410Row[]>();
  for (const r of rows) {
    if (!r.so) continue;
    const list = bySo.get(r.so) ?? [];
    list.push({ d: r.d, l: r.l ?? "", q: r.q ?? 0 });
    bySo.set(r.so, list);
  }
  p410Cache.set(db, { at: Date.now(), bySo });
  return bySo;
}
/** 수주번호의 출하포장 양품수량 합계 — before가 있으면 그 날짜 전날까지 */
function packedQty(db: DatabaseSync, so: string, before?: string): number {
  let sum = 0;
  for (const r of p410BySo(db).get(so) ?? []) if (!before || r.d < before) sum += r.q;
  return sum;
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
  /** UPH가 없어 계획을 계산할 수 없는 라인 — 계획을 직접 입력한다(예: 수동 5호기) */
  manualPlanLines: string[];
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
  // 칸별·수주번호별 계획수량 직접 입력 — 수주번호 우클릭 팝업에서 수주번호를 고르고 수주번호마다 계획수량을 넣어 저장한 값
  // (2026-10-05 사용자 요청). 있으면 자동 계산(UPH·예상 소요 하루 수량)보다 우선한다. 칸에서 수주번호가 빠지거나 바뀌면 함께 지운다.
  db.exec(`
    CREATE TABLE IF NOT EXISTS packaging_cell_so_plan (
      plan_date TEXT NOT NULL,
      line_key TEXT NOT NULL,
      so_no TEXT NOT NULL,
      plan_qty REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      PRIMARY KEY (plan_date, line_key, so_no)
    )
  `);
  // 칸 하나에 수량 하나만 두던 이전 표가 있으면 수주번호가 하나인 칸만 옮기고 지운다
  const oldTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'packaging_cell_plan'").get();
  if (oldTable) {
    db.exec(`
      INSERT OR IGNORE INTO packaging_cell_so_plan (plan_date, line_key, so_no, plan_qty)
        SELECT p.plan_date, p.line_key, TRIM(s.so_no), p.plan_qty
          FROM packaging_cell_plan p JOIN packaging_schedule s ON s.plan_date = p.plan_date AND s.line_key = p.line_key
         WHERE s.so_no IS NOT NULL AND instr(TRIM(s.so_no), ',') = 0 AND instr(TRIM(s.so_no), ' ') = 0;
      DROP TABLE packaging_cell_plan;
    `);
  }
  // 수주번호별 하루 계획 수량 — 팝업의 예상 소요(비슷한 물량대 과거 일CAPA, 천 개 단위 올림)로 배정한 값(2026-10-02 사용자 요청)
  db.exec(`
    CREATE TABLE IF NOT EXISTS packaging_so_capa (
      so_no TEXT PRIMARY KEY,
      daily_capa REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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

/** UPH가 없어 계획을 계산하지 못하는 라인 — 계획을 직접 입력한다 */
export function getManualPlanLines(db: DatabaseSync): string[] {
  const capa = loadCapaByLine(db);
  return PACKAGING_LINES.map((l) => l.key).filter((k) => !capa.has(k));
}

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
    const no = Number(m[1]);
    const key = no === 6 ? "vial" : `line${no}`; // 바이알 라인은 6호기를 쓴다
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
  for (const [so, lineKey] of lineBySo) {
    for (const r of p410BySo(db).get(so) ?? []) {
      if (r.d < from) {
        soPriorActual[so] = (soPriorActual[so] ?? 0) + r.q;
        continue;
      }
      if (r.d > to) continue;
      const a = (lineActuals[`${lineKey}|${r.d}`] ??= { total: 0, details: [] });
      a.total += r.q;
      a.details.push({ so, line: r.l, qty: r.q });
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
  // 수주번호가 일정(모든 라인·날짜)에서 처음 나오는 칸 — 날짜 순, 같은 날이면 라인 순
  const firstCellOfSo = new Map<string, string>();
  for (const r of db
    .prepare("SELECT plan_date, line_key, so_no FROM packaging_schedule WHERE so_no IS NOT NULL AND TRIM(so_no) <> '' ORDER BY plan_date, line_key")
    .all() as { plan_date: string; line_key: string; so_no: string }[]) {
    for (const t of splitSoNos(r.so_no)) if (!firstCellOfSo.has(t)) firstCellOfSo.set(t, `${r.plan_date}|${r.line_key}`);
  }
  const manualPlanLines = getManualPlanLines(db);
  const manualBySo = new Map<string, Record<string, number>>();
  for (const r of db.prepare("SELECT plan_date, line_key, so_no, plan_qty FROM packaging_cell_so_plan").all() as {
    plan_date: string;
    line_key: string;
    so_no: string;
    plan_qty: number;
  }[]) {
    const k = `${r.plan_date}|${r.line_key}`;
    (manualBySo.get(k) ?? manualBySo.set(k, {}).get(k)!)[r.so_no] = r.plan_qty;
  }
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
      // UPH가 없는 라인은 직접 입력해 저장한 계획을 그대로 쓴다
      plan_qty: planned && planned > 0 ? planned : manualPlanLines.includes(c.line_key) ? c.plan_qty : null,
      plan_manual: manualBySo.has(`${c.plan_date}|${c.line_key}`),
      plan_by_so: manualBySo.get(`${c.plan_date}|${c.line_key}`),
      order_qty: merged.order_qty > 0 ? merged.order_qty : null,
      order_qty_first:
        splitSoNos(c.so_no)
          .filter((t) => firstCellOfSo.get(t) === `${c.plan_date}|${c.line_key}`)
          .reduce((sum, t) => sum + (orderMap.get(t) ?? []).reduce((a, r) => a + (r.order_qty ?? 0), 0), 0) || null,
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
  return { from, to, lines: PACKAGING_LINES, cells: filledCells, lineActuals, soPriorActual, manualPlanLines, missingSoNos, holidays, workDays };
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
  ensurePackagingScheduleTable(db);
  if (!soNo) {
    db.prepare("DELETE FROM packaging_cell_so_plan WHERE plan_date = ? AND line_key = ?").run(planDate, lineKey);
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
  // 수주번호가 바뀌면 직접 입력했던 계획은 지운다(같은 번호를 다시 저장할 때는 그대로 둔다)
  const prevSo = (db.prepare("SELECT so_no FROM packaging_schedule WHERE plan_date = ? AND line_key = ?").get(planDate, lineKey) as { so_no: string | null } | undefined)?.so_no ?? null;
  const planReset = prevSo !== soNo ? { plan_qty: null } : {};
  // 칸에서 빠진 수주번호의 직접 입력 계획수량은 지운다
  const keep = splitSoNos(soNo);
  for (const r of db.prepare("SELECT so_no FROM packaging_cell_so_plan WHERE plan_date = ? AND line_key = ?").all(planDate, lineKey) as { so_no: string }[]) {
    if (!keep.includes(r.so_no)) db.prepare("DELETE FROM packaging_cell_so_plan WHERE plan_date = ? AND line_key = ? AND so_no = ?").run(planDate, lineKey, r.so_no);
  }
  upsertPackagingCell(
    db,
    planDate,
    lineKey,
    info
      ? {
          ...planReset,
          so_no: soNo,
          customer: info.customer,
          product_name: info.product_name,
          pack_size: info.pack_size,
          due_date: info.due_date,
        }
      : { ...planReset, so_no: soNo },
    user
  );
}

/**
 * 수주번호 우클릭 팝업에서 고른 수주번호(들)와 수주번호별 계획수량을 그 칸 하나에 저장한다 — 자동 배정(여러 날)이 아니라 이 칸만 바꾼다.
 * plans가 비어 있으면 직접 입력한 계획수량을 모두 지워 자동 계산으로 돌아간다.
 */
export function savePackagingCellPlan(
  db: DatabaseSync,
  planDate: string,
  lineKey: string,
  soNos: string[],
  plans: { so: string; qty: number }[],
  user: string | null
): void {
  savePackagingSoNo(db, planDate, lineKey, soNos.join(", "), user);
  db.prepare("DELETE FROM packaging_cell_so_plan WHERE plan_date = ? AND line_key = ?").run(planDate, lineKey);
  if (soNos.length === 0) return;
  const insert = db.prepare(
    `INSERT INTO packaging_cell_so_plan (plan_date, line_key, so_no, plan_qty, updated_at) VALUES (?, ?, ?, ?, datetime('now','localtime'))`
  );
  for (const p of plans) {
    if (soNos.includes(p.so) && Number.isFinite(p.qty) && p.qty > 0) insert.run(planDate, lineKey, p.so, p.qty);
  }
}

/** UPH가 없는 라인(manualPlanLines)의 계획을 직접 저장한다 */
export function savePackagingPlanQty(db: DatabaseSync, planDate: string, lineKey: string, qty: unknown, user: string | null): void {
  upsertPackagingCell(db, planDate, lineKey, { plan_qty: qty }, user);
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
  /** 개입수(포장단위수량) */
  pack_size: number | null;
  /** 계획할 수 있는 잔량 = 수주량 − 생산실적 − 일정에 이미 계획된 수량(지금 고치는 칸의 계획은 제외) — 직접 입력한 계획수량도 빼서 보여준다 */
  plan_remaining: number;
  /** PROD-10 과거 설비 사용 비율이 가장 높은 설비(1순위 추천) — 이력이 없는 신규 품목이면 null */
  recommend: EquipmentRecommendation | null;
  /** 비슷한 물량 구간의 과거 평균 일CAPA와 예상 소요일수(추천 설비 기준, 이력이 없으면 클릭한 라인의 설비 기준) */
  forecast: CapaForecast | null;
}

/** 포장 설비 이름 → 일정 라인 키: 자동포장기 1·2·3호기 / 포장 04·05호기 = 1~5 Line, 06호기 = 바이알 */
function lineKeyOfEquipment(name: string | null): string | null {
  const m = /(\d+)\s*호기/.exec(name ?? "");
  if (!m) return null;
  const no = Number(m[1]);
  return no === 6 ? "vial" : no >= 1 && no <= 5 ? `line${no}` : null;
}

// 품목별로 어느 포장 설비(호기)에서 작업했는지 — 일일작업현황(PROD-10) 출하포장(P410) 줄의 라인(설비) 값을 대표코드(품목코드에서
// 도수 구간을 뺀 앞부분, 예: 25A31-002-0075 → 25A31-002)별로 모은다(2026-10-02 사용자 요청). 일일작업현황은 새 실적이 올라올 때마다
// 늘어나므로 저장해 둔 집계표 없이 매번 읽어 계산하고(전체 읽기 약 0.7초), 10분 동안만 메모리에 재사용해 항상 최신 실적을 반영한다.
export interface EquipmentUse {
  line_key: string;
  equipment: string;
  uses: number;
  qty: number;
}
export interface EquipmentPreferenceRow extends EquipmentUse {
  rep_code: string;
  /** 그 대표코드 전체 사용수량 중 이 설비 비율(%) */
  ratio: number;
}
interface SoLineStat {
  so: string;
  line_key: string;
  reps: Set<string>;
  /** 전체 포장량(주간+야간) — 물량 구간을 정하는 데 쓴다 */
  qty: number;
  /** 주간 근무에서 포장한 양 — 일CAPA는 현재 근무(주간만)에 맞춰 주간 실적으로만 계산한다 */
  dayQty: number;
  /** 개입수(포장단위수량) — 포장량이 가장 많은 품목의 값 */
  pk: number | null;
  /** 수주에 들어 있는 품목 수(수주등록의 서로 다른 품목코드 수) */
  itemCount: number;
  /** LOT SIZE = (전체 포장량 ÷ 품목 수) ÷ 개입수 — 품목 하나당 팩 수 */
  lot: number | null;
  /** 작업일수 */
  days: number;
  /** 설비 하루 생산량 중 이 수주가 차지한 몫을 날짜별로 더한 "설비 일수 환산"(같은 날 여러 수주를 번갈아 포장해도 하루가 겹쳐 세어지지 않는다) */
  machineDays: number;
}
const p410LearnCache = new WeakMap<
  DatabaseSync,
  { at: number; repLines: Map<string, Map<string, EquipmentUse>>; soStats: SoLineStat[] }
>();
export function repCodeOf(itemCode: string): string {
  const m = /^([^-]+-[^-]+)/.exec(itemCode);
  return m ? m[1] : itemCode;
}
function p410Learn(db: DatabaseSync) {
  const hit = p410LearnCache.get(db);
  if (hit && Date.now() - hit.at < 600_000) return hit;
  const rows = db
    .prepare(
      `SELECT json_extract(detail, '$."수주번호"') so, item_code, json_extract(detail, '$."라인"') l, work_date d,
              json_extract(detail, '$."구분"') g, COUNT(*) n,
              SUM(CAST(json_extract(detail, '$."양품수량"') AS REAL)) q
         FROM daily_work_status WHERE process_code = 'P410' AND item_code IS NOT NULL
        GROUP BY so, item_code, l, work_date, g`
    )
    .all() as { so: string | null; item_code: string; l: string | null; d: string; g: string | null; n: number; q: number | null }[];
  // 품목별 개입수
  const pkByItem = new Map<string, number>();
  for (const r of db.prepare(`SELECT item_code, json_extract(detail, '$."포장단위수량"') pk FROM items`).all() as { item_code: string; pk: number | string | null }[]) {
    const n = Number(r.pk);
    if (Number.isFinite(n) && n > 0) pkByItem.set(r.item_code, n);
  }
  const repLines = new Map<string, Map<string, EquipmentUse>>();
  const soMap = new Map<string, { stat: SoLineStat; dates: Set<string>; byDate: Map<string, number>; pks: Map<number, number> }>();
  // 설비·날짜별 주간 생산량 — 수주가 하루에서 차지한 몫을 구하는 데 쓴다. 예전에는 주간·야간으로 근무했지만 지금은 주간만
  // 하므로(2026-10-05 사용자 설명) 일CAPA 계산에는 주간 실적만 쓴다.
  const dayTotals = new Map<string, number>();
  for (const r of rows) {
    const k = lineKeyOfEquipment(r.l);
    if (k && r.g === "주간") dayTotals.set(`${k}|${r.d}`, (dayTotals.get(`${k}|${r.d}`) ?? 0) + (r.q ?? 0));
  }
  for (const r of rows) {
    const key = lineKeyOfEquipment(r.l);
    if (!key) continue;
    const rep = repCodeOf(r.item_code);
    const lines = repLines.get(rep) ?? new Map<string, EquipmentUse>();
    const cur = lines.get(key) ?? { line_key: key, equipment: r.l ?? key, uses: 0, qty: 0 };
    cur.uses += r.n;
    cur.qty += r.q ?? 0;
    lines.set(key, cur);
    repLines.set(rep, lines);
    if (r.so) {
      const sk = `${r.so}|${key}`;
      const e =
        soMap.get(sk) ?? {
          stat: { so: r.so, line_key: key, reps: new Set<string>(), qty: 0, dayQty: 0, pk: null as number | null, itemCount: 0, lot: null as number | null, days: 0, machineDays: 0 },
          dates: new Set<string>(),
          byDate: new Map<string, number>(),
          pks: new Map<number, number>(),
        };
      e.stat.qty += r.q ?? 0;
      e.stat.reps.add(rep);
      const pk = pkByItem.get(r.item_code);
      if (pk) e.pks.set(pk, (e.pks.get(pk) ?? 0) + (r.q ?? 0));
      if (r.g === "주간") {
        e.stat.dayQty += r.q ?? 0;
        e.dates.add(r.d);
        e.byDate.set(r.d, (e.byDate.get(r.d) ?? 0) + (r.q ?? 0));
      }
      soMap.set(sk, e);
    }
  }
  // 수주번호별 품목 수 — LOT SIZE 계산에 쓴다
  const itemCountBySo = new Map<string, number>();
  for (const r of db
    .prepare(`SELECT json_extract(detail, '$."수주번호"') so, COUNT(DISTINCT item_code) n FROM sales_orders GROUP BY so`)
    .all() as { so: string | null; n: number }[]) {
    if (r.so) itemCountBySo.set(r.so, r.n);
  }
  const soStats = [...soMap.values()].map((e) => {
    let machineDays = 0;
    for (const [d, q] of e.byDate) {
      const total = dayTotals.get(`${e.stat.line_key}|${d}`) ?? 0;
      machineDays += total > 0 ? q / total : 1;
    }
    const pk = [...e.pks.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const itemCount = itemCountBySo.get(e.stat.so) ?? 0;
    const lot = pk && itemCount > 0 ? e.stat.qty / itemCount / pk : null;
    return { ...e.stat, pk, itemCount, lot, days: e.dates.size, machineDays };
  });
  const out = { at: Date.now(), repLines, soStats };
  p410LearnCache.set(db, out);
  return out;
}
function learnedRepLines(db: DatabaseSync): Map<string, Map<string, EquipmentUse>> {
  return p410Learn(db).repLines;
}

// ── 물량 규모별 일CAPA 예측 ────────────────────────────────────────────────────────
// 일일작업현황(PROD-10) 출하포장 실적을 수주번호×설비 단위로 묶어 (총 양품수량, 작업일수)를 구하고, 일평균 = 총량 ÷ 작업일수로
// 물량 구간별 평균 일CAPA를 낸다 — 단, 한 설비가 같은 날 여러 수주를 번갈아 포장하므로 수주별 작업일수를 그대로 세면 일CAPA가
// 낮게 나온다. 날짜별로 그 수주가 설비 하루 생산량에서 차지한 몫만 더한 "설비 일수 환산"으로 나눈다(구간 평균은 수량 가중). 작지번호는 품목·도수 한 건씩 나뉘어(최대 2천 개·1~3일) 일CAPA 기준이 안 되므로 수주번호로 묶었다.
// 물량 구간은 실제 분포(중앙값 2.1만, 75% 8만, 90% 17.5만, 상위 5% 29만 이상)에 맞춰 4구간으로 나눴다.
const VOLUME_BINS: { label: string; max: number }[] = [
  { label: "2만 이하", max: 20_000 },
  { label: "2~10만", max: 100_000 },
  { label: "10~30만", max: 300_000 },
  { label: "30만 초과", max: Infinity },
];
function volumeBin(qty: number): number {
  return VOLUME_BINS.findIndex((b) => qty <= b.max);
}
export interface CapaForecast {
  equipment: string;
  bin_label: string;
  /** 비슷한 물량 구간의 과거 평균 일CAPA */
  daily_capa: number;
  samples: number;
  /** item = 같은 대표코드·같은 개입수 이력 기준, equipment = 그 설비의 같은 물량 구간 이력 기준 */
  basis: "item" | "equipment";
  /** 개입수가 같은 이력만으로 계산했으면 true — 이력이 모자라 개입수 구분 없이 평균했으면 false */
  pack_matched: boolean;
  /** 이 수주의 개입수 */
  pack_size: number | null;
  /** 이 수주의 LOT SIZE((주문량 ÷ 품목 수) ÷ 개입수)와, LOT SIZE가 비슷한 이력만 썼을 때의 허용 범위(±30% 또는 ±50%) — 쓰지 않았으면 null */
  lot_size: number | null;
  lot_range: number | null;
  /** 이 수주의 품목 수 */
  item_count: number;
  /** 예상 소요일수 = 잔량 ÷ 일CAPA (올림) */
  est_days: number;
}
function forecastCapa(
  db: DatabaseSync,
  so: string,
  itemCodes: string[],
  lineKey: string,
  equipment: string,
  orderQty: number,
  remaining: number,
  packSize: number | null,
  itemCount: number
): CapaForecast | null {
  if (remaining <= 0) return null;
  const bin = volumeBin(orderQty);
  const reps = new Set(itemCodes.map(repCodeOf));
  // 일CAPA는 주간 실적 기준(현재 근무) — 주간 실적이 없는 수주는 뺀다. 물량 구간은 야간 포함 전체 포장량으로 정한다.
  const same = p410Learn(db).soStats.filter(
    (x) => x.so !== so && x.line_key === lineKey && x.machineDays > 0 && x.dayQty > 0 && volumeBin(x.qty) === bin
  );
  const pick = (list: SoLineStat[]) =>
    list.length ? list.reduce((a, x) => a + x.dayQty, 0) / list.reduce((a, x) => a + x.machineDays, 0) : 0;
  // 비슷한 이력만 쓴다(2026-10-05 사용자 요청): 개입수가 같고, LOT SIZE((주문량 ÷ 품목 수) ÷ 개입수)가 비슷한 수주를 우선한다.
  // ① 같은 품목 + 같은 개입수 + LOT ±20% 2건 이상 → ② 같은 품목 + 같은 개입수 2건 이상 → ③ 같은 개입수 + LOT ±20% 3건 이상
  // → ④ 같은 개입수 + LOT ±50% 3건 이상 → ⑤ 같은 개입수 3건 이상 → ⑥ 개입수 구분 없이 같은 물량 구간 전체
  const lot = packSize && itemCount > 0 ? orderQty / itemCount / packSize : null;
  const within = (list: SoLineStat[], pct: number) => (lot ? list.filter((x) => x.lot != null && Math.abs(x.lot - lot) <= lot * pct) : []);
  const samePack = packSize ? same.filter((x) => x.pk === packSize) : [];
  const itemPack = samePack.filter((x) => [...x.reps].some((r) => reps.has(r)));
  let list: SoLineStat[];
  let basis: "item" | "equipment" = "equipment";
  let packMatched = true;
  let lotRange: number | null = null;
  if (within(itemPack, 0.2).length >= 2) {
    list = within(itemPack, 0.2);
    basis = "item";
    lotRange = 0.2;
  } else if (itemPack.length >= 2) {
    list = itemPack;
    basis = "item";
  } else if (within(samePack, 0.2).length >= 3) {
    list = within(samePack, 0.2);
    lotRange = 0.2;
  } else if (within(samePack, 0.5).length >= 3) {
    list = within(samePack, 0.5);
    lotRange = 0.5;
  } else if (samePack.length >= 3) {
    list = samePack;
  } else {
    list = same;
    packMatched = false;
  }
  if (list.length === 0) return null;
  const raw = pick(list);
  if (raw <= 0) return null;
  const daily = Math.ceil(raw / 1000) * 1000; // 천 개 단위 올림(엑셀 ROUNDUP(x,-3)) — 계획 수량으로 그대로 쓴다
  return {
    equipment,
    bin_label: VOLUME_BINS[bin].label,
    daily_capa: daily,
    samples: list.length,
    basis,
    pack_matched: packMatched,
    pack_size: packSize,
    lot_size: lot,
    lot_range: lotRange,
    item_count: itemCount,
    est_days: Math.max(1, Math.ceil(remaining / daily)),
  };
}

/** 대표코드별 설비 선호도(대표코드, 설비명, 사용횟수, 사용수량, 비율%) — repCode를 주면 그 대표코드만, 사용수량 많은 순 */
export function fetchEquipmentPreference(db: DatabaseSync, repCode?: string): EquipmentPreferenceRow[] {
  const out: EquipmentPreferenceRow[] = [];
  for (const [rep, lines] of learnedRepLines(db)) {
    if (repCode && rep !== repCode) continue;
    const total = [...lines.values()].reduce((a, u) => a + u.qty, 0);
    for (const u of [...lines.values()].sort((a, b) => b.qty - a.qty)) {
      out.push({ ...u, rep_code: rep, ratio: total > 0 ? Math.round((u.qty / total) * 10000) / 100 : 0 });
    }
  }
  return out;
}
/** 그 품목이 실제로 작업된 라인들 — 대표코드 전체 작업량의 5% 이상 한 라인만 인정해 우연히 한두 번 돌린 설비는 뺀다. 이력이 없으면 null */
function learnedLinesOfItem(db: DatabaseSync, itemCode: string): Set<string> | null {
  const lines = learnedRepLines(db).get(repCodeOf(itemCode));
  if (!lines || lines.size === 0) return null;
  const total = [...lines.values()].reduce((a, u) => a + u.qty, 0);
  return new Set([...lines.values()].filter((u) => total <= 0 || u.qty / total >= 0.05).map((u) => u.line_key));
}
export interface EquipmentRecommendation {
  line_key: string;
  equipment: string;
  ratio: number;
  qty: number;
}
/** 수주 품목들의 과거 설비 사용을 합쳐 가장 비율 높은 설비를 1순위로 추천한다. 이력이 없으면 null */
function recommendEquipment(db: DatabaseSync, itemCodes: string[]): EquipmentRecommendation | null {
  const byLine = new Map<string, EquipmentUse>();
  for (const rep of new Set(itemCodes.map(repCodeOf))) {
    for (const u of learnedRepLines(db).get(rep)?.values() ?? []) {
      const cur = byLine.get(u.line_key) ?? { ...u, uses: 0, qty: 0 };
      cur.uses += u.uses;
      cur.qty += u.qty;
      byLine.set(u.line_key, cur);
    }
  }
  const total = [...byLine.values()].reduce((a, u) => a + u.qty, 0);
  const top = [...byLine.values()].sort((a, b) => b.qty - a.qty)[0];
  if (!top || total <= 0) return null;
  return { line_key: top.line_key, equipment: top.equipment, ratio: Math.round((top.qty / total) * 10000) / 100, qty: top.qty };
}

/**
 * 라인이 처리할 수 있는 포장방법·개입수(2026-10-02 사용자 설명) —
 * 2 Line: 원데이 중 개입수 10P·20P·30P만 / 1·3 Line: 사각·타원·원데이 / 5 Line: 원데이(보석) 전용(수동 포장도 함께) /
 * 바이알은 6호기(바이알 라인) / 나머지(물방울·Egg·Bulk·Dry Case·포장방법 없음 등)는 수동 라인(4·5 Line).
 */
function lineAcceptsMethod(lineKey: string, pm: string | null, packSize: number | null): boolean {
  const m = (pm ?? "").trim();
  if (m === "원데이(보석)") return lineKey === "line5";
  if (m === "원데이") {
    if (lineKey === "line1" || lineKey === "line3") return true;
    return lineKey === "line2" && packSize != null && [10, 20, 30].includes(packSize);
  }
  if (m === "바이알") return lineKey === "vial";
  if (m === "사각" || m === "타원") return lineKey === "line1" || lineKey === "line3";
  return lineKey === "line4" || lineKey === "line5";
}

/**
 * 수주(품목 여러 개일 수 있음)가 그 라인에서 포장 가능한가 — 품목별로 PROD-10 출하포장 작업 설비 이력이 있으면 그 이력(해당 라인에서
 * 작업한 적이 있는 품목)으로, 이력이 없는 품목은 위의 포장방법·개입수 기준(임시)으로 본다.
 */
function lineAcceptsItems(db: DatabaseSync, lineKey: string, itemCodes: string[], pm: string | null, packSize: number | null): boolean {
  const fallback = lineAcceptsMethod(lineKey, pm, packSize);
  let withHistory = 0;
  for (const ic of itemCodes) {
    const lines = learnedLinesOfItem(db, ic);
    if (!lines) continue;
    withHistory++;
    if (lines.has(lineKey)) return true;
    // 이력이 수동 라인(4·5 Line)뿐이어도 포장방법상 그 자동 라인에서 포장할 수 있으면 후보로 본다(2026-10-06 사용자 요청 —
    // 예: 사각 품목이 소량이라 5호기에서만 포장한 이력이 있어도 1호기 팝업에 보여준다)
    if ([...lines].every((l) => l === "line4" || l === "line5") && fallback && lineKey !== "line4" && lineKey !== "line5") return true;
  }
  return withHistory === 0 || withHistory < itemCodes.length ? fallback : false;
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
              MAX(json_extract(it.detail, '$."포장방법"')) pm,
              MAX(CAST(json_extract(it.detail, '$."포장단위수량"') AS INTEGER)) pk,
              GROUP_CONCAT(DISTINCT so.item_code) ics
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
    .all(sinceDue) as { sono: string; cname: string | null; grp: string | null; qty: number | null; due: string | null; pm: string | null; pk: number | null; ics: string | null }[];
  const eligible = rows.filter((r) => r.sono && lineAcceptsItems(db, lineKey, (r.ics ?? "").split(",").filter(Boolean), r.pm, r.pk));
  const packed = new Map<string, number>();
  for (const r of eligible) packed.set(r.sono, packedQty(db, r.sono, exceptCell?.date));
  const remainingAfter = allocateCellPlans(
    db,
    exceptCell ? (d, l) => d === exceptCell.date && l === exceptCell.line : undefined
  ).remainingAfter;
  const out: PackagingCandidate[] = [];
  // 오늘 이전 날짜 칸은 이미 실적이 끝난 수주도 다시 넣을 수 있게 완료/계획 완료 수주를 빼지 않는다(2026-10-07 사용자 요청 —
  // 과거 일정을 지웠다가 다시 넣을 때 실적이 완료된 수주번호가 후보에 안 보임)
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const pastCell = !!exceptCell && exceptCell.date < todayStr;
  for (const r of eligible) {
    const qty = r.qty ?? 0;
    const done = packed.get(r.sono) ?? 0;
    if (!pastCell && qty > 0 && done >= qty) continue;
    // 수주량만큼 일정에 계획이 이미 잡힌 수주는 뺀다(2026-10-02 사용자 요청)
    if (!pastCell && qty > 0 && remainingAfter.has(r.sono) && (remainingAfter.get(r.sono) ?? 0) <= 0) continue;
    const ics = (r.ics ?? "").split(",").filter(Boolean);
    const rec = recommendEquipment(db, ics);
    // 일정에 계획이 이미 잡힌 수주는 그만큼 뺀 값이 계획할 잔량이다(계획이 없으면 수주량 − 생산실적)
    const planRemaining = Math.max(0, remainingAfter.has(r.sono) ? (remainingAfter.get(r.sono) ?? 0) : qty - done);
    out.push({ so_no: r.sono, customer: r.cname, product_group: r.grp, order_qty: qty, packed_qty: done, due_date: r.due,
      pack_method: r.pm,
      pack_size: r.pk,
      plan_remaining: planRemaining,
      recommend: rec,
      forecast: forecastCapa(db, r.sono, ics, rec?.line_key ?? lineKey, rec?.equipment ?? PACKAGING_LINES.find((l) => l.key === lineKey)?.label ?? lineKey, qty, planRemaining, r.pk, ics.length),
    });
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
    .prepare("SELECT plan_date, line_key, so_no, plan_qty FROM packaging_schedule WHERE so_no IS NOT NULL AND TRIM(so_no) <> '' ORDER BY plan_date, line_key")
    .all() as { plan_date: string; line_key: string; so_no: string; plan_qty: number | null }[];
  const tokens = [...new Set(cells.flatMap((c) => splitSoNos(c.so_no)))];
  const orderMap = fetchOrderRowsByTokens(db, tokens);
  const remaining = new Map<string, number>();
  const cellPlan = new Map<string, number>();
  ensurePackagingScheduleTable(db);
  const soCapa = new Map(
    (db.prepare("SELECT so_no, daily_capa FROM packaging_so_capa").all() as { so_no: string; daily_capa: number }[]).map((r) => [r.so_no, r.daily_capa])
  );
  const cellManual = new Map<string, Map<string, number>>();
  for (const r of db.prepare("SELECT plan_date, line_key, so_no, plan_qty FROM packaging_cell_so_plan").all() as {
    plan_date: string;
    line_key: string;
    so_no: string;
    plan_qty: number;
  }[]) {
    const k = `${r.plan_date}|${r.line_key}`;
    (cellManual.get(k) ?? cellManual.set(k, new Map()).get(k)!).set(r.so_no, r.plan_qty);
  }
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
        const packed = packedQty(db, t, c.plan_date);
        remaining.set(t, rows.reduce((sum, r) => sum + (r.order_qty ?? 0), 0) - packed);
      }
    }
    // 팝업에서 수주번호별 계획수량을 직접 입력한 칸 — 그 수량을 그대로 계획으로 보고 각 수주의 남은 양에서 뺀다
    const manualMap = cellManual.get(`${c.plan_date}|${c.line_key}`);
    if (manualMap && manualMap.size > 0) {
      let total = 0;
      for (const [so, qty] of manualMap) {
        if (!toks.includes(so)) continue;
        remaining.set(so, (remaining.get(so) ?? 0) - qty);
        total += qty;
      }
      if (total > 0) cellPlan.set(`${c.plan_date}|${c.line_key}`, total);
      continue;
    }
    const cap = capa.get(c.line_key);
    if (!cap && !toks.some((t) => soCapa.has(t))) {
      // UPH가 없는 라인 — 직접 입력한 계획만큼 첫 수주번호의 남은 양에서 뺀다
      const manual = c.plan_qty ?? 0;
      if (manual > 0) {
        cellPlan.set(`${c.plan_date}|${c.line_key}`, manual);
        remaining.set(toks[0], (remaining.get(toks[0]) ?? 0) - manual);
      }
      continue;
    }
    // 하루를 설비 시간 1로 보고 수주마다 (가져간 양 ÷ 그 수주의 하루 계획)만큼 쓴다 — 개입수가 다른 수주가 섞여도 계산된다
    let fraction = 1;
    let total = 0;
    let computed = false;
    for (const t of toks) {
      if (fraction <= 1e-9) break;
      const rows = orderMap.get(t);
      if (!rows) continue;
      const tp = summarizeOrder(rows).pack_size;
      const pn = tp && /^\d+$/.test(tp.trim()) ? Number(tp) : 0;
      // 팝업 예상 소요로 배정한 수주는 그 하루 수량을, 아니면 포장기 UPH × 작업시간 × 개입수를 쓴다
      const daily = soCapa.get(t) ?? (cap && pn > 0 ? Math.round(cap.uph * cap.hours * pn) : 0);
      if (daily <= 0) continue;
      computed = true;
      const room = Math.max(0, remaining.get(t) ?? 0);
      const take = Math.min(room, daily * fraction);
      remaining.set(t, (remaining.get(t) ?? 0) - take);
      fraction -= take / daily;
      total += take;
    }
    if (!computed) continue;
    cellPlan.set(`${c.plan_date}|${c.line_key}`, Math.round(total));
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
 * 들어 있는 칸은 건드리지 않고 건너뛴다. 여러 수주번호면 적힌 순서대로 이어서 채우되, 하루 계획에 여유가 있으면 다음 수주가 같은 날 칸에 함께 들어간다.
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
  const batch = new Set(soNos);
  // 하루를 설비 시간 1로 보고, 수주마다 (남은 양 ÷ 그 수주의 하루 계획)만큼 시간을 쓴다 — 작은 수주 여러 개는 하루 한 칸에 같이 들어간다
  const items: { so: string; daily: number; remaining: number; dates: string[] }[] = [];
  const singles: string[] = [];
  for (const so of soNos) {
    const info = lookupOrderInfo(db, so);
    if (!info) {
      result.missing.push(so);
      continue;
    }
    const pn = info.pack_size && /^\d+$/.test(info.pack_size.trim()) ? Number(info.pack_size) : 0;
    // 이미 다른 칸(이 라인 시작일 이후는 제외)에서 계획돼 남은 양이 있으면 그것에서, 없으면 수주량 − 시작일 전날까지의 실적에서 시작
    const alloc = allocateCellPlans(db, (d, l) => l === lineKey && d >= startDate).remainingAfter;
    const remaining = alloc.has(so) ? (alloc.get(so) ?? 0) : info.order_qty - packedQty(db, so, startDate);
    // 하루 계획 = 팝업의 예상 소요 일 수량(비슷한 물량대 과거 평균 일CAPA, 천 개 단위 올림) — 이력이 없으면 UPH × 작업시간 × 개입수
    const ics = (
      db
        .prepare(
          `SELECT DISTINCT item_code FROM sales_orders
            WHERE json_extract(detail, '$."수주번호"') = ? OR substr(so_no, 1, CASE WHEN instr(so_no, '-') > 0 THEN instr(so_no, '-') - 1 ELSE length(so_no) END) = ?`
        )
        .all(so, so) as { item_code: string }[]
    ).map((r) => r.item_code);
    const rec = recommendEquipment(db, ics);
    const fc = forecastCapa(
      db,
      so,
      ics,
      rec?.line_key ?? lineKey,
      rec?.equipment ?? PACKAGING_LINES.find((l) => l.key === lineKey)?.label ?? lineKey,
      info.order_qty,
      remaining,
      pn > 0 ? pn : null,
      ics.length
    );
    const daily = fc?.daily_capa ?? (cap && pn > 0 ? Math.round(cap.uph * cap.hours * pn) : 0);
    if (daily <= 0) {
      singles.push(so); // 하루 계획을 못 구하면 한 칸에 하나씩만
      continue;
    }
    db.prepare(
      `INSERT INTO packaging_so_capa (so_no, daily_capa, updated_at) VALUES (?, ?, datetime('now','localtime'))
       ON CONFLICT(so_no) DO UPDATE SET daily_capa = excluded.daily_capa, updated_at = excluded.updated_at`
    ).run(so, daily);
    items.push({ so, daily, remaining, dates: [] });
  }
  const free = (d: string): boolean => {
    const cur = occupied.get(d);
    return !isOff(d) && (!cur || splitSoNos(cur).every((t) => batch.has(t)));
  };
  let idx = 0;
  let guard = 0;
  while (idx < items.length && guard++ < 400) {
    if (!free(cursor)) {
      cursor = addDays(cursor, 1);
      continue;
    }
    let fraction = 1;
    const tokens: string[] = [];
    while (idx < items.length && fraction > 1e-9) {
      const it = items[idx];
      const take = Math.max(0, Math.min(it.remaining, it.daily * fraction));
      tokens.push(it.so);
      it.dates.push(cursor);
      fraction -= take / it.daily;
      it.remaining -= take;
      if (it.remaining <= 0.5) idx++;
      else break; // 하루가 다 찼다 — 같은 수주가 다음 근무일로 이어진다
    }
    savePackagingSoNo(db, cursor, lineKey, tokens.join(", "), user);
    occupied.set(cursor, tokens.join(", "));
    cursor = addDays(cursor, 1);
  }
  for (const it of items) result.filled.push({ so_no: it.so, dates: it.dates });
  for (const so of singles) {
    savePackagingSoNo(db, cursor, lineKey, so, user);
    result.singleOnly.push(so);
    result.filled.push({ so_no: so, dates: [cursor] });
    occupied.set(cursor, so);
    cursor = addDays(cursor, 1);
  }
  return result;
}
