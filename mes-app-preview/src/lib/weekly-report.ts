import type { DatabaseSync } from "node:sqlite";
import { ensureLineCapaPlanTable } from "./production-plan-lines";
import { moldSum, processSum } from "./production-status";
import {
  WEEKLY_DEFECT_PROCESSES,
  WEEKLY_DEFECT_TABLE1,
  WEEKLY_DEFECT_TABLE2,
  WEEKLY_YIELD_PROCESSES,
  type WeeklyDefectRow,
  type WeeklyPlanBlock,
  type WeeklyPlanRow,
  type WeeklyPrintingBlock,
  type WeeklyPrintingRow,
  type WeeklyReportResult,
  type WeeklyYieldRow,
} from "./weekly-report-shared";

export * from "./weekly-report-shared";

// 생산관리 "주간업무보고(PROD-11)" — 실제 제출용 서식 "생산팀 주간 업무_38W.docx"(전체본)를
// MES 데이터로 채운다(2026-09-29 사용자 요청). 서식에서 확인한 규칙:
// - 주차 구간은 월~일이 아니라 금~목이다(37 W = 09/04~09/10, 38 W = 09/11~09/17). 주차 번호는
//   구간 마지막 날(목요일)이 속한 ISO 주차다(9/10 → 37, 9/17 → 38, 10/1 → 40).
// - 보고일은 구간 종료 다음 월요일이다(38 W → 9/21).
// - 수율(YLD) = 양품수량 / (양품수량 + 불량수량) — 불량종합현황(PROD-07, defect_type_status)
//   의 공정명별 합계. 서식의 37 W 값과 9/4~9/10 실데이터가 소수 첫째 자리까지 일치함을 확인.
//   TTL은 각 공정 수율의 곱이다. 사출(몰드) 수율은 MES에 근거 데이터가 없어(불량종합현황에 사출
//   공정 자체가 없음) 비워 두고, TTL은 렌즈 공정만의 곱(서식의 "사출제외")으로 계산한다.
// - 인쇄공정 표는 계획 대비가 아니라 수동/자동 인쇄기별 가동대수·생산수량이다(computePrinting).
// - 계획(월) 표는 PLAN-02 라인별 일CAPA × 그 주차의 생산캘린더 근무일수, 실적은 MGMT-05와 같은
//   집계(사출=MOLD입고량, 인쇄=착색인쇄 P220, 출하=출하포장 P410)를 쓴다. 월을 걸치는 주차는
//   그 달에 속한 날짜만 잘라 계산한다(서식의 36 W 행은 8월 날짜까지 합쳤지만 월 합계가 겹쳐
//   이중 집계되므로 이 화면은 달 경계로 자른다).

// 비고 후보 — 위 두 표에 없는 불량유형 전부(가장 큰 것 하나를 "유형 0.00%"로 표기).
const NOTE_CANDIDATE_KEYS = [
  "인쇄 不", "S/C", "성형 不", "안착불량", "기포", "수량착오", "기타", "색맞춤", "Test(SAMPLE)", "중심",
  "터짐", "식염수 부족", "수량 부족", "수량 이상", "실링지 이물", "실링지 오부착", "실링지 찍힘",
  "실링지 밀림", "실링지 끊어짐", "잔량", "기타2", "출고생산", "마킹불량", "융착불량", "무렌즈",
  "캡불량", "도수측정", "렌즈붙음", "렌즈혼입", "렌즈끼임", "렌즈겹침", "팩불량", "팩이물", "양품불량",
  "유실", "설비오작동", "미해마", "PPT", "직경불량", "도수불량", "BC불량", "두께불량",
];
const NOTE_EXCLUDE = new Set(["인쇄 不"]); // 표2에 이미 열로 있음

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return toDateStr(new Date(y, m - 1, d + delta));
}
function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).getDay(); // 0=일 ... 5=금
}
function monthEndOf(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${pad2(new Date(y, m, 0).getDate())}`;
}
function mmdd(dateStr: string): string {
  return `${dateStr.slice(5, 7)}/${dateStr.slice(8, 10)}`;
}

/** 임의 날짜가 속한 금~목 주차의 시작(금요일) */
export function weekStartOf(dateStr: string): string {
  return addDays(dateStr, -((weekdayOf(dateStr) - 5 + 7) % 7));
}

/** 주차 번호 = 구간 마지막 날(목요일)이 속한 ISO 주차 */
export function weekNoOf(weekStart: string): number {
  const thu = addDays(weekStart, 6);
  const [y, m, d] = thu.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const jan1 = Date.UTC(y, 0, 1);
  const dayOfYear = Math.floor((t - jan1) / 86400000);
  // 목요일 기준 ISO 주차: 그 해 첫 목요일이 속한 주가 1주차.
  const jan1Dow = new Date(y, 0, 1).getDay();
  const firstThuOffset = (4 - jan1Dow + 7) % 7; // 1/1 이후 첫 목요일까지 일수
  return Math.floor((dayOfYear - firstThuOffset) / 7) + 1;
}

/** 오늘 기준 이미 끝난 가장 최근 금~목 주차의 시작일 */
export function defaultWeekStart(today: string): string {
  const cur = weekStartOf(today);
  // 오늘이 주차의 마지막 날(목)이면 그 주차도 끝난 것으로 보지 않는다(당일 실적 미입력) — 직전 주차.
  return addDays(cur, -7);
}

function workDaysBetween(db: DatabaseSync, from: string, to: string): number {
  if (from > to) return 0;
  return (
    db
      .prepare(`SELECT COUNT(*) c FROM production_calendar WHERE cal_date BETWEEN ? AND ? AND work_yn = 'Y'`)
      .get(from, to) as { c: number }
  ).c;
}

interface PlanLineSpec {
  key: WeeklyPlanBlock["key"];
  title: string;
  columns: string[];
  lineKeys: string[]; // line_capa_plan.line_key (컬럼 순서)
  actual: (db: DatabaseSync, colIndex: number, from: string, to: string) => number;
}
const PLAN_LINES: PlanLineSpec[] = [
  {
    key: "injection",
    title: "사출",
    columns: ["상몰드", "하몰드"],
    lineKeys: ["injection_upper", "injection_lower"],
    actual: (db, i, from, to) => moldSum(db, i === 0 ? "상몰드" : "하몰드", from, to),
  },
  {
    key: "shipping",
    title: "출하",
    columns: ["출하포장"],
    lineKeys: ["shipping"],
    actual: (db, _i, from, to) => processSum(db, ["P410"], from, to),
  },
];

// 인쇄공정 표(인쇄공정.JPG) — 착색 인쇄(P220) 실적을 설비(라인)별로 나눠 "자동인쇄N호기"는
// 자동인쇄기, 나머지("착색 NN호기")는 수동인쇄기로 본다. 가동대수 = 그날 양품수량이 있는 설비 수
// (수량이 비어 있는 시험설비 "착색 30호기"는 자연히 빠진다). 평균 가동대수 = 일별 가동대수 합 ÷
// 그 기간의 생산캘린더 근무일수(전산 장애로 생산이 없던 근무일도 0대로 평균에 들어간다 —
// 서식의 9.8대 = 49대 ÷ 5일). 전주도 같은 방식으로 계산한다.
interface PrintingDay {
  units: [number, number]; // [수동, 자동]
  qty: [number, number];
}
function printingByDay(db: DatabaseSync, from: string, to: string): Map<string, PrintingDay> {
  const rows = db
    .prepare(
      `SELECT work_date, json_extract(detail, '$."라인"') AS line,
              SUM(CAST(json_extract(detail, '$."양품수량"') AS REAL)) AS qty
       FROM daily_work_status
       WHERE process_code = 'P220' AND work_date BETWEEN ? AND ?
       GROUP BY work_date, line`
    )
    .all(from, to) as { work_date: string; line: string | null; qty: number | null }[];
  const map = new Map<string, PrintingDay>();
  for (const r of rows) {
    const q = r.qty ?? 0;
    if (q <= 0) continue;
    const day = map.get(r.work_date) ?? { units: [0, 0], qty: [0, 0] };
    const i = (r.line ?? "").startsWith("자동인쇄") ? 1 : 0;
    day.units[i] += 1;
    day.qty[i] += q;
    map.set(r.work_date, day);
  }
  return map;
}

function computePrinting(db: DatabaseSync, weekStart: string): WeeklyPrintingBlock {
  const weekEnd = addDays(weekStart, 6);
  const prevStart = addDays(weekStart, -7);
  const prevEnd = addDays(weekStart, -1);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const cur = printingByDay(db, weekStart, weekEnd);
  const prev = printingByDay(db, prevStart, prevEnd);
  // 평균 가동대수 = 가동대수 합 ÷ "실적이 있는 근무일"수. 휴일(생산캘린더 work_yn='N', 추석연휴·주말
  // 등)은 소수 설비가 돌았더라도 분자·분모 모두에서 빼고, 근무일이어도 아직 실적이 입력되지 않은
  // 날(2026-09-29 사용자 요청)도 뺀다. 수동/자동/합계가 같은 분모(그날 인쇄 실적 유무)를 쓴다.
  // 생산수량 합계는 휴일 실적도 그대로 포함한다.
  const workDates = new Set(
    (
      db
        .prepare(`SELECT cal_date FROM production_calendar WHERE cal_date BETWEEN ? AND ? AND work_yn = 'Y'`)
        .all(prevStart, weekEnd) as { cal_date: string }[]
    ).map((r) => r.cal_date)
  );
  const activeDays = (map: Map<string, PrintingDay>): number => [...map.keys()].filter((d) => workDates.has(d)).length;
  const curWorkDays = activeDays(cur);
  const prevWorkDays = activeDays(prev);

  const build = (label: string, pick: (d: PrintingDay) => { u: number; q: number }): WeeklyPrintingRow => {
    const perDay = dates.map((d) => {
      const day = cur.get(d);
      return day ? pick(day) : { u: 0, q: 0 };
    });
    const prevAll = [...prev.entries()].map(([date, day]) => ({ date, ...pick(day) }));
    const prevUnits = prevAll.filter((v) => workDates.has(v.date)).reduce((s, v) => s + v.u, 0);
    const unitsSum = perDay.reduce((s, v, i) => (workDates.has(dates[i]) ? s + v.u : s), 0);
    return {
      label,
      prevAvgUnits: prevWorkDays > 0 && prevUnits > 0 ? prevUnits / prevWorkDays : null,
      prevQty: prevAll.reduce((s, v) => s + v.q, 0),
      units: perDay.map((v) => (v.q > 0 ? v.u : null)),
      qty: perDay.map((v) => v.q),
      avgUnits: curWorkDays > 0 && unitsSum > 0 ? unitsSum / curWorkDays : null,
      totalQty: perDay.reduce((s, v) => s + v.q, 0),
    };
  };
  return {
    prevWeekLabel: `${weekNoOf(prevStart)} W`,
    prevWorkDays,
    weekLabel: `${weekNoOf(weekStart)} W`,
    dates,
    rows: [
      build("수동인쇄기", (d) => ({ u: d.units[0], q: d.qty[0] })),
      build("자동인쇄기", (d) => ({ u: d.units[1], q: d.qty[1] })),
      build("합계", (d) => ({ u: d.units[0] + d.units[1], q: d.qty[0] + d.qty[1] })),
    ],
  };
}

function buildPlanBlock(
  db: DatabaseSync,
  spec: PlanLineSpec,
  yearMonth: string,
  weekEnd: string,
  dailyCapaByLine: Map<string, number | null>
): WeeklyPlanBlock {
  const monthStart = `${yearMonth}-01`;
  const monthEnd = monthEndOf(yearMonth);
  const capas = spec.lineKeys.map((k) => dailyCapaByLine.get(k) ?? null);
  const capaMissing = capas.some((c) => c == null);
  const cols = spec.lineKeys.length;
  const totalWorkDays = workDaysBetween(db, monthStart, monthEnd);
  const elapsedTo = weekEnd < monthEnd ? weekEnd : monthEnd;
  const elapsedWorkDays = workDaysBetween(db, monthStart, elapsedTo);

  const weeks: WeeklyPlanRow[] = [];
  const sumActual = new Array<number>(cols).fill(0);
  const sumDiff = new Array<number>(cols).fill(0);
  // 월의 첫 날이 속한 금~목 주차부터 월말이 속한 주차까지
  for (let ws = weekStartOf(monthStart); ws <= monthEnd; ws = addDays(ws, 7)) {
    const from = ws < monthStart ? monthStart : ws;
    const to = addDays(ws, 6) > monthEnd ? monthEnd : addDays(ws, 6);
    const days = workDaysBetween(db, from, to);
    const started = ws <= weekEnd;
    const plan = capas.map((c) => (c ?? 0) * days);
    const actual = capas.map((_c, i) => (started ? spec.actual(db, i, from, to < weekEnd ? to : weekEnd) : null));
    const diff = actual.map((a, i) => (a == null ? null : a - plan[i]));
    const rate = actual.map((a, i) => (a == null || plan[i] <= 0 ? null : a / plan[i]));
    actual.forEach((a, i) => {
      if (a != null) sumActual[i] += a;
    });
    diff.forEach((d, i) => {
      if (d != null) sumDiff[i] += d;
    });
    weeks.push({
      weekLabel: `${weekNoOf(ws)} W`,
      // 표시는 주차 전체 구간(예: 40 W = 09/25~10/01) — 계획/실적 계산만 월 경계로 자른다.
      rangeLabel: `${mmdd(ws)}~${mmdd(addDays(ws, 6))}`,
      plan,
      actual,
      diff,
      rate,
    });
  }

  const monthPlan = capas.map((c) => (c ?? 0) * totalWorkDays);
  const monthRate = sumActual.map((a, i) => (monthPlan[i] > 0 ? a / monthPlan[i] : null));
  const totalPlan = monthPlan.reduce((s, v) => s + v, 0);
  const totalActual = sumActual.reduce((s, v) => s + v, 0);
  return {
    key: spec.key,
    title: spec.title,
    columns: spec.columns,
    weeks,
    month: {
      label: `${Number(yearMonth.slice(5, 7))} 월`,
      rangeLabel: `${mmdd(monthStart)}~${mmdd(monthEnd)}`,
      plan: monthPlan,
      actual: sumActual,
      diff: sumDiff,
      rate: monthRate,
    },
    totalWorkDays,
    elapsedWorkDays,
    progressRate: totalWorkDays > 0 ? elapsedWorkDays / totalWorkDays : null,
    achievementRate: totalPlan > 0 ? totalActual / totalPlan : null,
    capaMissing,
  };
}

interface DefectAgg {
  good: number;
  bad: number;
  types: Map<string, number>;
}

function aggregateDefects(db: DatabaseSync, process: string, from: string, to: string): DefectAgg {
  const typeKeys = [
    ...new Set([
      ...WEEKLY_DEFECT_TABLE1.flatMap((c) => c.keys),
      ...WEEKLY_DEFECT_TABLE2.flatMap((c) => c.keys),
      ...NOTE_CANDIDATE_KEYS,
    ]),
  ];
  const select = typeKeys
    .map((k, i) => `SUM(CAST(json_extract(detail, '$."${k}"') AS REAL)) AS t${i}`)
    .join(", ");
  const row = db
    .prepare(
      `SELECT SUM(CAST(json_extract(detail, '$."양품수량"') AS REAL)) AS good,
              SUM(CAST(json_extract(detail, '$."불량수량"') AS REAL)) AS bad, ${select}
       FROM defect_type_status
       WHERE json_extract(detail, '$."공정명"') = ? AND order_date BETWEEN ? AND ?`
    )
    .get(process, from, to) as Record<string, number | null>;
  const types = new Map<string, number>();
  typeKeys.forEach((k, i) => types.set(k, row[`t${i}`] ?? 0));
  return { good: row.good ?? 0, bad: row.bad ?? 0, types };
}

function yieldRow(db: DatabaseSync, weekStart: string): WeeklyYieldRow {
  const from = weekStart;
  const to = addDays(weekStart, 6);
  const yields = WEEKLY_YIELD_PROCESSES.map((p) => {
    const a = aggregateYieldOnly(db, p, from, to);
    return a.good + a.bad > 0 ? a.good / (a.good + a.bad) : null;
  });
  const present = yields.filter((y): y is number => y != null);
  return {
    weekLabel: `${weekNoOf(weekStart)} W`,
    yields,
    total: present.length > 0 ? present.reduce((p, y) => p * y, 1) : null,
  };
}

function aggregateYieldOnly(db: DatabaseSync, process: string, from: string, to: string): { good: number; bad: number } {
  const row = db
    .prepare(
      `SELECT SUM(CAST(json_extract(detail, '$."양품수량"') AS REAL)) AS good,
              SUM(CAST(json_extract(detail, '$."불량수량"') AS REAL)) AS bad
       FROM defect_type_status
       WHERE json_extract(detail, '$."공정명"') = ? AND order_date BETWEEN ? AND ?`
    )
    .get(process, from, to) as { good: number | null; bad: number | null };
  return { good: row.good ?? 0, bad: row.bad ?? 0 };
}

export function computeWeeklyReport(db: DatabaseSync, anyDate: string): WeeklyReportResult {
  const weekStart = weekStartOf(anyDate);
  const weekEnd = addDays(weekStart, 6);
  // 계획 표의 기준 월은 주차 시작일이 속한 달이다 — 40 W(09/25~10/01)는 9월 표의 마지막 행이다.
  const yearMonth = weekStart.slice(0, 7);

  ensureLineCapaPlanTable(db);
  const capaRows = db
    .prepare(`SELECT line_key, daily_capa FROM line_capa_plan WHERE year_month = ?`)
    .all(yearMonth) as { line_key: string; daily_capa: number | null }[];
  const dailyCapaByLine = new Map(capaRows.map((r) => [r.line_key, r.daily_capa]));
  const plan = PLAN_LINES.map((spec) => buildPlanBlock(db, spec, yearMonth, weekEnd, dailyCapaByLine));

  const current = yieldRow(db, weekStart);
  const previous = yieldRow(db, addDays(weekStart, -7));
  const diffPct = current.total != null && previous.total != null ? current.total - previous.total : null;

  const defect: WeeklyDefectRow[] = WEEKLY_DEFECT_PROCESSES.map(({ process, label }) => {
    const agg = aggregateDefects(db, process, weekStart, weekEnd);
    const workQty = agg.good + agg.bad;
    const rateOf = (keys: readonly string[]): number | null =>
      workQty > 0 ? keys.reduce((s, k) => s + (agg.types.get(k) ?? 0), 0) / workQty : null;
    let noteKey = "";
    let noteQty = 0;
    for (const k of NOTE_CANDIDATE_KEYS) {
      if (NOTE_EXCLUDE.has(k)) continue;
      const q = agg.types.get(k) ?? 0;
      if (q > noteQty) {
        noteQty = q;
        noteKey = k;
      }
    }
    return {
      label,
      workQty,
      goodQty: agg.good,
      badQty: agg.bad,
      yld: workQty > 0 ? agg.good / workQty : null,
      table1: WEEKLY_DEFECT_TABLE1.map((c) => rateOf(c.keys)),
      table2: WEEKLY_DEFECT_TABLE2.map((c) => rateOf(c.keys)),
      note: noteKey && workQty > 0 ? `${noteKey === "기타2" ? "기타" : noteKey} ${((noteQty / workQty) * 100).toFixed(2)}%` : "",
    };
  });

  return {
    weekNo: weekNoOf(weekStart),
    weekStart,
    weekEnd,
    reportDate: addDays(weekEnd, 4),
    yearMonth,
    plan,
    printing: computePrinting(db, weekStart),
    yield: { current, previous, diffPct },
    defect,
  };
}
