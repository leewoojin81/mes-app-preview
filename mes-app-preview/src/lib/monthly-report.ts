import type { DatabaseSync } from "node:sqlite";
import { moldSum, processSum, workHoursSum } from "./production-status";
import {
  addDays,
  buildDefectRows,
  injectionYield,
  loadDayProcessYield,
  monthEndOf,
  printingByDay,
  weekNoOf,
  weekStartOf,
  yieldFromDays,
  type DayProcessYield,
  type PrintingDay,
} from "./weekly-report";
import { WEEKLY_YIELD_PROCESSES } from "./weekly-report-shared";
import {
  MONTHLY_PRODUCTION_PROCESSES,
  type MonthlyPrintingBlock,
  type MonthlyPrintingRow,
  type MonthlyProductionRow,
  type MonthlyReportResult,
  type MonthlyTrendPoint,
  type MonthlyYieldRow,
} from "./monthly-report-shared";

export * from "./monthly-report-shared";

// 생산관리 "월간업무보고(PROD-12)" — 서식 "생산팀 월간 업무.docx"(2026-10-16 사용자 요청)를 MES 데이터로 채운다.
// 서식에서 확인한 규칙(9월 서식의 숫자를 9월 실데이터와 대조해 일치함을 확인):
// - 1. 공정별 생산실적 = 공정별 월 생산량(K천대). 사출을 뺀 공정은 일일작업현황(PROD-10) 양품수량 합계(착색 3,130.7·
//   조립 2,842.9·출하 2,711.5 등 서식과 같음). 사출은 사출 실적이 MES에 없어 MOLD입고현황 입고량(상·하몰드)에서
//   불량(사출창고→불량창고 이동·불량창고 입고)을 뺀 뒤 상·하 한 쌍이 렌즈 1개라 2로 나눈다.
// - 생산성 = 생산량(K천대) ÷ 그 공정의 근무시간(2026-10-16 사용자 지정). 근무시간은 PSN-01 근무시간입력의 공정별 합계로,
//   생산현황(MGMT-05)의 UPH와 같은 기준(다른 공정 지원은 빼고 이 공정으로 온 지원은 더함)이다.
// - 인쇄공정 표 = 착색 인쇄(P220) 설비 가동대수·생산수량을 월을 걸치는 금~목 주차 구간(월 경계로 자름)별로.
// - 월별 수율 표/차트·주요공정 불량률은 주간업무보고(PROD-11)와 같은 규칙을 한 달 구간에 적용한다.
// - 수율 추이 차트 구간(서식: 2025 1Q~2026 1Q, 4월~9월): 마지막으로 끝난 분기의 첫 달부터 보고 월까지 월별 + 그 앞 최근
//   5개 분기(데이터가 있는 것, 최소 2개).

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function mmdd(dateStr: string): string {
  return `${dateStr.slice(5, 7)}/${dateStr.slice(8, 10)}`;
}

/** 오늘 기준 이미 끝난 가장 최근 달(보고 대상 월) — "YYYY-MM" */
export function defaultReportMonth(today: string): string {
  const [y, m] = today.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function prevMonthOf(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function computeProduction(db: DatabaseSync, from: string, to: string): MonthlyProductionRow[] {
  return MONTHLY_PRODUCTION_PROCESSES.map(({ label, code }) => {
    let qty: number;
    if (code === "P100") {
      const received = moldSum(db, "상몰드", from, to) + moldSum(db, "하몰드", from, to);
      const y = injectionYield(db, from, to);
      qty = y == null ? 0 : (received * y) / 2;
    } else {
      qty = processSum(db, [code], from, to);
    }
    const hours = workHoursSum(db, code, from, to);
    return { label, qty, hours, productivity: hours > 0 && qty > 0 ? qty / 1000 / hours : null };
  });
}

function computePrinting(db: DatabaseSync, from: string, to: string): MonthlyPrintingBlock {
  const workDates = new Set(
    (
      db.prepare(`SELECT cal_date FROM production_calendar WHERE cal_date BETWEEN ? AND ? AND work_yn = 'Y'`).all(from, to) as {
        cal_date: string;
      }[]
    ).map((r) => r.cal_date)
  );
  const days = printingByDay(db, from, to);

  // 월을 걸치는 금~목 주차를 월 경계로 자른 구간
  const weeks: { label: string; from: string; to: string }[] = [];
  for (let ws = weekStartOf(from); ws <= to; ws = addDays(ws, 7)) {
    const segFrom = ws < from ? from : ws;
    const we = addDays(ws, 6);
    const segTo = we > to ? to : we;
    weeks.push({ label: `${weekNoOf(ws)} W`, from: segFrom, to: segTo });
  }

  const build = (label: string, pick: (d: PrintingDay) => { u: number; q: number }): MonthlyPrintingRow => {
    const perWeek = weeks.map((w) => {
      let unitsSum = 0;
      let activeDays = 0;
      let q = 0;
      for (const [date, day] of days) {
        if (date < w.from || date > w.to) continue;
        const v = pick(day);
        q += v.q;
        // 평균 가동대수 = 가동대수 합 ÷ "실적이 있는 근무일"수 (휴일 실적은 수량만 포함, 주간업무보고와 같은 규칙)
        if (workDates.has(date) && (day.qty[0] > 0 || day.qty[1] > 0)) {
          activeDays++;
          unitsSum += v.u;
        }
      }
      return { avg: activeDays > 0 && unitsSum > 0 ? unitsSum / activeDays : null, q, unitsSum, activeDays };
    });
    const totalUnits = perWeek.reduce((s, w) => s + w.unitsSum, 0);
    const totalDays = perWeek.reduce((s, w) => s + w.activeDays, 0);
    return {
      label,
      units: perWeek.map((w) => w.avg),
      qty: perWeek.map((w) => w.q),
      avgUnits: totalDays > 0 && totalUnits > 0 ? totalUnits / totalDays : null,
      totalQty: perWeek.reduce((s, w) => s + w.q, 0),
    };
  };
  return {
    workDays: workDates.size,
    weekLabels: weeks.map((w) => w.label),
    rangeLabels: weeks.map((w) => `${mmdd(w.from)}~${mmdd(w.to)}`),
    rows: [
      build("수동인쇄기", (d) => ({ u: d.units[0], q: d.qty[0] })),
      build("자동인쇄기", (d) => ({ u: d.units[1], q: d.qty[1] })),
      build("합계", (d) => ({ u: d.units[0] + d.units[1], q: d.qty[0] + d.qty[1] })),
    ],
  };
}

// 두 달(전월·당월) 수율 행 — 2개월치 불량종합현황만 읽어 빠르다.
function computeYieldRows(db: DatabaseSync, ym: string): { previous: MonthlyYieldRow; current: MonthlyYieldRow } {
  const prev = prevMonthOf(ym);
  const days: DayProcessYield = loadDayProcessYield(db, `${prev}-01`, monthEndOf(ym));
  const row = (m: string): MonthlyYieldRow => {
    const y = yieldFromDays(db, days, `${m}-01`, monthEndOf(m));
    return { monthLabel: `${m.slice(5, 7)}월`, injection: y.injection, yields: y.yields, total: y.total, totalExInjection: y.totalExInjection };
  };
  return { previous: row(prev), current: row(ym) };
}

// 수율 추이 차트 — 5개 분기 + 월별을 한 번에 읽어 21개월치 불량종합현황을 훑느라 10초 넘게 걸린다. 업로드가 없으면 값이
// 같으므로 불량종합현황의 행 수·최대 id가 그대로인 동안 10분간 재사용한다.
const trendCache = new Map<string, { at: number; sig: string; trend: MonthlyTrendPoint[] }>();
export function computeYieldTrend(db: DatabaseSync, ym: string): MonthlyTrendPoint[] {
  const sig = JSON.stringify(db.prepare("SELECT COUNT(*) c, MAX(id) m FROM defect_type_status").get());
  const hit = trendCache.get(ym);
  if (hit && hit.sig === sig && Date.now() - hit.at < 600_000) return hit.trend;

  const to = monthEndOf(ym);
  const ey = Number(ym.slice(0, 4));
  const em = Number(ym.slice(5, 7));
  // 마지막으로 끝난 분기(연*4 + 분기-1)와 그 첫 달 — 월별 점은 거기서 보고 월까지
  const lastQuarterIdx = ey * 4 + Math.ceil(em / 3) - 1 - 1;
  const firstMonthIdx = Math.floor(lastQuarterIdx / 4) * 12 + (lastQuarterIdx % 4) * 3;
  const curMonthIdx = ey * 12 + (em - 1);
  const ymOf = (idx: number) => `${Math.floor(idx / 12)}-${pad2((idx % 12) + 1)}`;
  const quarterRange = (qIdx: number): [string, string] => {
    const y = Math.floor(qIdx / 4);
    const m1 = (qIdx % 4) * 3 + 1;
    return [`${y}-${pad2(m1)}-01`, monthEndOf(`${y}-${pad2(m1 + 2)}`)];
  };
  const quarterIdxs = [1, 2, 3, 4, 5].map((k) => lastQuarterIdx - k).reverse();
  const days: DayProcessYield = loadDayProcessYield(db, quarterRange(quarterIdxs[0])[0], to);

  const make = (label: string, kind: MonthlyTrendPoint["kind"], f: string, t: string): MonthlyTrendPoint => {
    const y = yieldFromDays(db, days, f, t);
    // 수율 공정 중 하나라도 데이터가 없으면 곱이 실제보다 높게 나온다 — 이름만 두고 값은 비운다
    const incomplete = y.yields.some((v) => v == null) || (y.total == null && y.totalExInjection == null);
    return { label, kind, total: incomplete ? null : y.total, exInjection: incomplete ? null : y.totalExInjection };
  };
  const quarterPoints = quarterIdxs.map((q) => {
    const [f, t] = quarterRange(q);
    return make(`${Math.floor(q / 4)}년 ${(q % 4) + 1}Q`, "quarter", f, t);
  });
  let quarters = quarterPoints.filter((p) => p.total != null);
  if (quarters.length < 2) quarters = quarterPoints.slice(-2);
  const monthPoints: MonthlyTrendPoint[] = [];
  for (let idx = firstMonthIdx; idx <= curMonthIdx; idx++) {
    const m = ymOf(idx);
    monthPoints.push(make(`${Number(m.slice(5, 7))}월`, "month", `${m}-01`, monthEndOf(m)));
  }
  const trend = [...quarters, ...monthPoints];
  trendCache.set(ym, { at: Date.now(), sig, trend });
  return trend;
}

/** withTrend=false면 수율 추이 차트(느림)를 빼고 빈 배열로 둔다 — 화면은 먼저 보여준 뒤 추이만 따로 받아 채운다. */
export function computeMonthlyReport(db: DatabaseSync, yearMonth: string, withTrend = true): MonthlyReportResult {
  const dateFrom = `${yearMonth}-01`;
  const dateTo = monthEndOf(yearMonth);
  return {
    yearMonth,
    monthNo: Number(yearMonth.slice(5, 7)),
    dateFrom,
    dateTo,
    reportDate: addDays(dateTo, 1),
    production: computeProduction(db, dateFrom, dateTo),
    printing: computePrinting(db, dateFrom, dateTo),
    yield: { ...computeYieldRows(db, yearMonth), trend: withTrend ? computeYieldTrend(db, yearMonth) : [] },
    defect: buildDefectRows(db, dateFrom, dateTo),
  };
}

// WEEKLY_YIELD_PROCESSES 순서와 열 수가 서식(Base 인쇄~출하포장 10열)과 같아야 한다.
export const MONTHLY_YIELD_COLUMN_COUNT = WEEKLY_YIELD_PROCESSES.length;
