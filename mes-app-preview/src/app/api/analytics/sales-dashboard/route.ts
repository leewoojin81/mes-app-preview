import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const ORDER_DATE_EXPR = `COALESCE(NULLIF(replace(json_extract(so.detail, '$.수주일자'), '.', '-'), ''), substr(so.created_at, 1, 10))`;
// 수주량(EA) 집계 — 화폐 단위가 섞인 금액과 달리 수량은 통화 환산 없이 그대로 합산한다.
// 수량이 없는 행(극히 일부)은 수량 합계에서는 빠지지만 건수(수주 건수)에는 포함한다.
// detail(원본 엑셀) 없이 화면에서 직접 등록한 수주는 detail.수량이 없으므로 실컬럼
// order_qty로 폴백한다 — 안 그러면 수동 등록분이 집계에서 통째로 빠진다.
const QTY_EXPR = `COALESCE(json_extract(so.detail, '$.수량'), so.order_qty)`;
// so_no(PK)는 "수주번호-품목순번" 형태라 같은 수주번호에 품목 라인이 여러 개면 행이 여러 개 생긴다.
// "수주 건수"는 라인 건수가 아니라 중복 없는 순수 수주번호 개수를 세야 한다.
// detail.수주번호가 없는 수동 등록분은 so_no(PK) 자체로 폴백한다.
const SO_NO_EXPR = `COALESCE(json_extract(so.detail, '$.수주번호'), so.so_no)`;
// "전체 제품" 필터와 "제품별 수주량" 도넛 모두 품목코드의 마스터 속성(제품등록
// BASE-01) 중 "주기"(1Day/Monthly/Half Yearly/...) 기준 — so.detail의 품목군이
// 아니라 items.detail을 봐야 하므로 이 표현식을 쓰는 쿼리는 모두 items를 조인해야 한다.
const CYCLE_EXPR = `COALESCE(NULLIF(json_extract(it.detail, '$.주기'), ''), '기타')`;

interface Filters {
  where: string;
  args: (string | number)[];
}

function buildFilters(params: URLSearchParams, opts?: { skip?: "customer" | "cycle" }): Filters {
  const conditions: string[] = [];
  const args: (string | number)[] = [];
  const dateFrom = params.get("dateFrom");
  const dateTo = params.get("dateTo");
  if (dateFrom) {
    conditions.push(`${ORDER_DATE_EXPR} >= ?`);
    args.push(dateFrom);
  }
  if (dateTo) {
    conditions.push(`${ORDER_DATE_EXPR} <= ?`);
    args.push(dateTo);
  }
  const customer = params.get("customer");
  if (customer && opts?.skip !== "customer") {
    conditions.push("so.customer_code = ?");
    args.push(customer);
  }
  const cycle = params.get("cycle");
  if (cycle && opts?.skip !== "cycle") {
    conditions.push(`${CYCLE_EXPR} = ?`);
    args.push(cycle);
  }
  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", args };
}

// "제품별 수주량" 도넛은 상위 4개 + 기타로 고정 표기한다.
const TOP_N_CYCLE = 4;
// "고객사별 수주량" 도넛은 누적 비중이 80%에 도달할 때까지의 고객사만 표기하고 나머지는 기타로 묶는다.
const CUSTOMER_CUM_PCT_THRESHOLD = 80;

// "YYYY-MM-DD" 문자열의 연도만 delta만큼 이동 — 윤년 2/29 등 예외 없이 "작년 같은 날짜" 개념으로 충분.
function shiftYear(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-");
  return `${String(Number(y) + delta).padStart(4, "0")}-${m}-${d}`;
}

// "YYYY-MM" 달이 [dateFrom, dateTo] 구간에 처음부터 끝까지 완전히 포함되는지 —
// 예: dateTo가 2026-09-04면 9월은 1일~30일이 다 안 들어오니 false(9/4까지만 있는
// 진행 중인 달). "평균월수주량"이 이런 반쪽 달까지 나눠버리면 실제보다 낮게
// 나오므로, 평균 계산에서는 이 함수로 걸러낸 완전한 달만 쓴다.
function isMonthFullyInRange(month: string, dateFrom: string, dateTo: string): boolean {
  const [y, m] = month.split("-").map(Number);
  const firstDay = `${month}-01`;
  const lastDayNum = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastDay = `${month}-${String(lastDayNum).padStart(2, "0")}`;
  return firstDay >= dateFrom && lastDay <= dateTo;
}

// dateFrom~dateTo(포함) 사이의 모든 "YYYY-MM"을 순서대로 나열 — 특정 거래처/제품
// 필터를 걸면 일부 달에 수주가 아예 없을 수 있는데, 그런 달도 항상 표시하기 위함.
function monthsBetween(dateFrom: string, dateTo: string): string[] {
  let [y, m] = dateFrom.slice(0, 7).split("-").map(Number);
  const [toY, toM] = dateTo.slice(0, 7).split("-").map(Number);
  const months: string[] = [];
  while (y < toY || (y === toY && m <= toM)) {
    months.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

// 목표(계획) 출처 전환 기준월 — 이 달(포함) 이후부터는 월별수주(목표)등록(SALES-01,
// sales_monthly_customer_plan) 합산값을 쓰고, 이전 달은 기존처럼 화면에서 직접 입력한
// sales_monthly_plan 값을 그대로 유지한다(2026-09-07 사용자 요청 — 1~8월은 이미 확정된
// 수동 입력값이라 안 건드리고, 9월부터만 SALES-01 연동으로 넘어간다).
const SALES01_CUTOVER_MONTH = "2026-09";

// 경영정보 "월별수주현황분석(MGMT-04)" — 수주등록(SALES-02) 수주량(EA)을 실시간 집계해
// 대쉬보드_영업.PNG "디자인 2" 레이아웃과 동일한 KPI/차트/표 데이터를 구성한다.
// 목표(계획)는 SALES01_CUTOVER_MONTH 기준으로 출처가 갈린다(위 상수 설명 참고) —
// 9월 이후는 SALES-01 합산(고객사 필터 반영), 8월 이전은 sales_monthly_plan 수동값.
// 월별수주현황(MGMT-02)은 이 화면과 별개 API(analytics/monthly-orders)라 항상
// sales_monthly_plan을 직접 입력한다 — 9월 이후는 두 화면의 목표값 출처가 다르다는
// 뜻이니 헷갈리지 않도록 유의.
export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;

  // 기간을 지정하지 않으면 2026-01-01 ~ 오늘을 기본값으로 쓴다.
  const today = (
    db.prepare("SELECT date('now','localtime') as d").get() as { d: string }
  ).d;
  let dateFrom = params.get("dateFrom");
  let dateTo = params.get("dateTo");
  dateFrom = dateFrom ?? "2026-01-01";
  dateTo = dateTo ?? today;
  const effectiveParams = new URLSearchParams(params);
  effectiveParams.set("dateFrom", dateFrom);
  effectiveParams.set("dateTo", dateTo);

  const { where, args } = buildFilters(effectiveParams);

  const monthlyRaw = db
    .prepare(
      `SELECT substr(${ORDER_DATE_EXPR}, 1, 7) as month,
              SUM(${QTY_EXPR}) as qty,
              COUNT(DISTINCT ${SO_NO_EXPR}) as order_count
       FROM sales_orders so
       JOIN items it ON it.item_code = so.item_code
       ${where}
       GROUP BY month
       ORDER BY month`
    )
    .all(...args) as { month: string; qty: number | null; order_count: number }[];

  // 조회기간의 모든 달을 항상 포함시킨다 — 특정 거래처/제품 필터로 수주가 없는
  // 달도 0으로 채워서 표시(빠지지 않도록).
  const monthlyByMonth = new Map(monthlyRaw.map((r) => [r.month, r]));
  const monthly = monthsBetween(dateFrom, dateTo).map((month) => {
    const r = monthlyByMonth.get(month);
    return { month, qty: r?.qty ?? 0, order_count: r?.order_count ?? 0 };
  });

  // SALES01_CUTOVER_MONTH(9월) 이후: SALES-01(sales_monthly_customer_plan)에서 목표수량을
  // 합산한다 — customer 필터가 있으면 그 고객사만, 없으면 전체 고객사 합계.
  const customerFilter = params.get("customer");
  const salesOnePlanRows = (
    customerFilter
      ? db
          .prepare(
            `SELECT printf('%04d-%02d', year, month) as month, SUM(qty) as plan_qty
             FROM sales_monthly_customer_plan WHERE customer_code = ? GROUP BY year, month`
          )
          .all(customerFilter)
      : db
          .prepare(
            `SELECT printf('%04d-%02d', year, month) as month, SUM(qty) as plan_qty
             FROM sales_monthly_customer_plan GROUP BY year, month`
          )
          .all()
  ) as { month: string; plan_qty: number | null }[];
  const salesOnePlanByMonth = new Map(salesOnePlanRows.map((r) => [r.month, r.plan_qty]));

  // SALES01_CUTOVER_MONTH 이전: 기존 수동 입력값(sales_monthly_plan)을 그대로 쓴다.
  const legacyPlanRows = db
    .prepare("SELECT month, plan_qty FROM sales_monthly_plan")
    .all() as { month: string; plan_qty: number | null }[];
  const legacyPlanByMonth = new Map(legacyPlanRows.map((r) => [r.month, r.plan_qty]));

  const planByMonth = new Map<string, number | null>();
  for (const month of monthsBetween(dateFrom, dateTo)) {
    planByMonth.set(
      month,
      month >= SALES01_CUTOVER_MONTH
        ? (salesOnePlanByMonth.get(month) ?? null)
        : (legacyPlanByMonth.get(month) ?? null)
    );
  }

  const totalQty = monthly.reduce((s, r) => s + (r.qty ?? 0), 0);
  const totalCount = monthly.reduce((s, r) => s + r.order_count, 0);
  // 평균월수주량은 진행 중인(끝나지 않은) 달을 빼고, 구간에 완전히 포함된 달만으로
  // 계산한다 — 예: 2026-01-01~09-04 조회 시 1~8월만으로 평균을 낸다(9월은 4일치뿐이라
  // 포함하면 평균이 실제보다 낮게 나옴). 완전한 달이 하나도 없으면(조회 구간이 한 달도
  // 안 채워진 경우) 예전처럼 있는 달 전체로 계산한다.
  const completeMonths = monthly.filter((r) => isMonthFullyInRange(r.month, dateFrom, dateTo));
  const avgMonthlyQty =
    completeMonths.length > 0
      ? completeMonths.reduce((s, r) => s + (r.qty ?? 0), 0) / completeMonths.length
      : monthly.length > 0
        ? totalQty / monthly.length
        : 0;
  const maxMonth = monthly.reduce<{ month: string; qty: number } | null>((best, r) => {
    if (r.qty == null) return best;
    if (!best || r.qty > best.qty) return { month: r.month, qty: r.qty };
    return best;
  }, null);
  const last = monthly.length > 0 ? monthly[monthly.length - 1] : null;
  const prev = monthly.length > 1 ? monthly[monthly.length - 2] : null;
  const momChangePct =
    last?.qty != null && prev?.qty != null && prev.qty > 0
      ? +(((last.qty - prev.qty) / prev.qty) * 100).toFixed(1)
      : null;

  const byCustomerRaw = db
    .prepare(
      `SELECT c.customer_name as name, SUM(${QTY_EXPR}) as qty
       FROM sales_orders so
       JOIN customers c ON c.customer_code = so.customer_code
       JOIN items it ON it.item_code = so.item_code
       ${where ? `${where} AND ${QTY_EXPR} IS NOT NULL` : `WHERE ${QTY_EXPR} IS NOT NULL`}
       GROUP BY so.customer_code
       ORDER BY qty DESC`
    )
    .all(...args) as { name: string; qty: number }[];

  const byCycleRaw = db
    .prepare(
      `SELECT ${CYCLE_EXPR} as name, SUM(${QTY_EXPR}) as qty
       FROM sales_orders so
       JOIN items it ON it.item_code = so.item_code
       ${where ? `${where} AND ${QTY_EXPR} IS NOT NULL` : `WHERE ${QTY_EXPR} IS NOT NULL`}
       GROUP BY name
       ORDER BY qty DESC`
    )
    .all(...args) as { name: string; qty: number }[];

  function topNWithOther(rows: { name: string; qty: number }[], topN: number) {
    const top = rows.slice(0, topN);
    const rest = rows.slice(topN).reduce((s, r) => s + r.qty, 0);
    const all = rest > 0 ? [...top, { name: "기타", qty: rest }] : top;
    const sum = all.reduce((s, r) => s + r.qty, 0);
    return all.map((r) => ({ ...r, pct: sum > 0 ? +((r.qty / sum) * 100).toFixed(1) : 0 }));
  }

  // rows는 이미 qty DESC 정렬되어 있다고 가정 — 누적 비중이 thresholdPct에 도달하는 지점까지만
  // 개별 이름을 남기고(그 지점의 항목까지 포함), 나머지는 "기타"로 합친다.
  function topByCumPct(rows: { name: string; qty: number }[], thresholdPct: number) {
    const totalSum = rows.reduce((s, r) => s + r.qty, 0);
    const top: { name: string; qty: number }[] = [];
    let cum = 0;
    for (const r of rows) {
      top.push(r);
      cum += totalSum > 0 ? (r.qty / totalSum) * 100 : 0;
      if (cum >= thresholdPct) break;
    }
    const rest = rows.slice(top.length).reduce((s, r) => s + r.qty, 0);
    const all = rest > 0 ? [...top, { name: "기타", qty: rest }] : top;
    const sum = all.reduce((s, r) => s + r.qty, 0);
    return all.map((r) => ({ ...r, pct: sum > 0 ? +((r.qty / sum) * 100).toFixed(1) : 0 }));
  }

  // 전년 동기(같은 조회기간을 1년 전으로 이동) 누계 — 같은 필터(고객사/제품)로 다시 집계한다.
  const priorFrom = shiftYear(dateFrom, -1);
  const priorTo = shiftYear(dateTo, -1);
  const priorParams = new URLSearchParams(effectiveParams);
  priorParams.set("dateFrom", priorFrom);
  priorParams.set("dateTo", priorTo);
  const { where: priorWhere, args: priorArgs } = buildFilters(priorParams);
  const priorAgg = db
    .prepare(
      `SELECT SUM(${QTY_EXPR}) as qty, COUNT(DISTINCT ${SO_NO_EXPR}) as order_count
       FROM sales_orders so
       JOIN items it ON it.item_code = so.item_code
       ${priorWhere}`
    )
    .get(...priorArgs) as { qty: number | null; order_count: number };
  const priorHasData = priorAgg.order_count > 0;
  const priorQty = priorAgg.qty ?? 0;
  const yoyChangePct =
    priorHasData && priorQty > 0 ? +(((totalQty - priorQty) / priorQty) * 100).toFixed(1) : null;
  const yoyCountChangePct =
    priorHasData && priorAgg.order_count > 0
      ? +(((totalCount - priorAgg.order_count) / priorAgg.order_count) * 100).toFixed(1)
      : null;

  return NextResponse.json({
    dateFrom,
    dateTo,
    kpi: {
      total_qty: totalQty,
      avg_monthly_qty: Math.round(avgMonthlyQty),
      avg_monthly_qty_month_count: completeMonths.length > 0 ? completeMonths.length : monthly.length,
      avg_monthly_qty_excluded_partial_month:
        completeMonths.length > 0 && completeMonths.length < monthly.length,
      max_month: maxMonth,
      order_count: totalCount,
      mom_change_pct: momChangePct,
      yoy_change_pct: yoyChangePct,
    },
    priorYear: {
      dateFrom: priorFrom,
      dateTo: priorTo,
      has_data: priorHasData,
      total_qty: priorQty,
      order_count: priorAgg.order_count,
      qty_change_pct: yoyChangePct,
      count_change_pct: yoyCountChangePct,
    },
    monthly: monthly.map((r) => ({
      month: r.month,
      qty: r.qty ?? 0,
      order_count: r.order_count,
      plan_qty: planByMonth.get(r.month) ?? null,
    })),
    byCustomer: topByCumPct(byCustomerRaw, CUSTOMER_CUM_PCT_THRESHOLD),
    byCycle: topNWithOther(byCycleRaw, TOP_N_CYCLE),
  });
}

// 목표량(plan_qty) 수정 — SALES01_CUTOVER_MONTH(9월) 이전 달만 허용한다. 그 달들은
// 여전히 sales_monthly_plan 수동값을 쓰기 때문(월별수주현황 MGMT-02와 공유). 9월
// 이후는 SALES-01(sales_monthly_customer_plan)에서 자동 합산되므로 여기서 막고,
// 값을 바꾸려면 SALES-01에서 하도록 안내한다.
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { month, plan_qty } = (body ?? {}) as { month?: string; plan_qty?: number | string | null };
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month는 YYYY-MM 형식이어야 합니다." }, { status: 400 });
  }
  if (month >= SALES01_CUTOVER_MONTH) {
    return NextResponse.json(
      { error: "9월 이후 목표량은 월별수주(목표)등록(SALES-01)에서 수정해 주세요." },
      { status: 400 }
    );
  }
  const qty = plan_qty != null && plan_qty !== "" ? Number(plan_qty) : 0;
  if (!Number.isFinite(qty)) {
    return NextResponse.json({ error: "목표량이 올바르지 않습니다." }, { status: 400 });
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO sales_monthly_plan (month, plan_qty, updated_at)
     VALUES (?, ?, datetime('now','localtime'))
     ON CONFLICT(month) DO UPDATE SET plan_qty = excluded.plan_qty, updated_at = excluded.updated_at`
  ).run(month, qty);

  return NextResponse.json({ ok: true, month, plan_qty: qty });
}
