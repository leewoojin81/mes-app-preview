import type { DatabaseSync } from "node:sqlite";
import { ensureLineCapaPlanTable } from "./production-plan-lines";
import { getProcessUphTarget } from "./process-uph-target";

// 경영정보 "공정별생산현황(MGMT-05, 매일 아침 회의용)" — PLAN-02와 같은 9개 라인
// (간접직 제외)을 쓰되, 사출_상/사출_하는 몰드 자체의 생산 실적이라 별도 실적 리포트가
// 없다(2026-09-13 확인 — 사출은 daily_work_status에 공정명 자체가 없음). 대신 사출로
// 만든 몰드가 그대로 "입고"되는 MOLD입고현황(INV-04, mold_receipt_status)의 품목군
// (상몰드/하몰드)별 입고량을 생산실적으로, 현재고현황(INV-02, inventory_status)의
// 사출창고·품목군별 재고수량을 재공품으로 대신 쓴다. 나머지 7개 라인의 실적은
// 일일작업현황(PROD-10, daily_work_status)에서 라인당 "공정명"이 정확히 일치하는
// 공정코드 하나만 가져온다(2026-09-13 사용자 확인 — 착색=착색 인쇄, 조립=조립,
// 분리=분리3, 외관=외관검사, 실링=실링, 마킹=마킹, 포장=출하포장. PLAN-02의 라인 정의는
// 같은 라인 안의 여러 세부공정을 CAPA/인원 집계용으로 묶어둔 것이라 그대로 쓰면 실제
// 생산량 집계 지점과 안 맞는 공정까지 더해진다). 2026-09-28 사용자 요청으로 인원·근무시간
// (생산성 UPH의 분모)도 같은 단일 공정코드(workProcessCode)로 통일했다 — 사출=P100,
// 인쇄=P220, 조립=P300, 분리=P340(오타 확인), 외관=P360, 실링=P370, 마킹=P400, 포장=P410.
// 근무시간은 고정 8hr 가정 대신 PSN-01(work_hours_daily)에 기록된 실제 근무시간 합계를
// 쓴다. 재공품(공정재공현황 INV-03, process_wip_status)은 원래부터 같은 이름의 컬럼
// 하나만 쓰고 있어 그대로 둔다.
export interface ProductionStatusLineDef {
  key: string;
  label: string;
  isMold: boolean;
  moldGroup?: "상몰드" | "하몰드";
  /** isMold=false일 때 daily_work_status 실적 집계에 쓸 단일 공정코드(BASE-04) —
   *  process_wip_status의 재공수량 컬럼 키(원본 헤더명, 아래 wipColumnKey)와 같은
   *  공정을 가리킨다. */
  processCode?: string;
  /** 인원(workers.process_code)·근무시간(work_hours_daily.process_code) 집계에 쓸 단일
   *  공정코드. 사출_상/사출_하는 같은 사출(P100) 인원이 담당해 둘 다 P100. */
  workProcessCode: string;
  /** isMold=false일 때 process_wip_status detail JSON의 재공수량 컬럼 키(원본 헤더명) */
  wipColumnKey?: string;
}

export const PRODUCTION_STATUS_LINES: ProductionStatusLineDef[] = [
  { key: "injection_upper", label: "사출상몰드", isMold: true, moldGroup: "상몰드", workProcessCode: "P100" },
  { key: "injection_lower", label: "사출하몰드", isMold: true, moldGroup: "하몰드", workProcessCode: "P100" },
  { key: "coloring", label: "착색인쇄", isMold: false, processCode: "P220", workProcessCode: "P220", wipColumnKey: "착색 인쇄" },
  { key: "assembly", label: "조립", isMold: false, processCode: "P300", workProcessCode: "P300", wipColumnKey: "조립" },
  { key: "separation", label: "분리3", isMold: false, processCode: "P340", workProcessCode: "P340", wipColumnKey: "분리3" },
  { key: "appearance", label: "외관검사", isMold: false, processCode: "P360", workProcessCode: "P360", wipColumnKey: "외관검사" },
  { key: "sealing", label: "실링", isMold: false, processCode: "P370", workProcessCode: "P370", wipColumnKey: "실링" },
  { key: "marking", label: "마킹", isMold: false, processCode: "P400", workProcessCode: "P400", wipColumnKey: "마킹" },
  { key: "shipping", label: "출하포장", isMold: false, processCode: "P410", workProcessCode: "P410", wipColumnKey: "출하포장" },
];

export interface ProductionStatusRow {
  key: string;
  label: string;
  isMold: boolean;
  headcount: number;
  /** 월 목표생산량 = 계획정보(PLAN-02) 일CAPA × 총작업가능일(없으면 null) */
  monthlyTarget: number | null;
  /** 일 목표생산량 — 계획정보(PLAN-02) line_capa_plan.daily_capa 그대로 */
  dailyTarget: number | null;
  yesterdayQty: number;
  mtdQty: number;
  wip: number;
  /** 과부족수량 = 전일생산량 - 일목표생산량 */
  shortage: number | null;
  /** 달성율 = 전일생산량 / 일목표생산량 */
  achievementRate: number | null;
  /** 진도율(라인) = 누적생산량 / 월목표생산량 */
  progressRate: number | null;
  /** 월계획대비 진도율대비 과부족 = 진도율(라인) - 진도율(전체, 작업일수/총작업가능일) — %p */
  progressGap: number | null;
  /** 누적과부족(당월) = 누적생산량 - 월목표생산량×진도율(전체) — 달력 진행 속도대로면 있어야 할 수량과의 차이 */
  cumulativeShortage: number | null;
  /** 전일 UPH = 전일생산량 / 전일 근무시간 합계(PSN-01, 기록 없으면 null) */
  yesterdayUph: number | null;
  /** 이번달 누적 UPH = 누적생산량 / 이번달 1일~전일 근무시간 합계 */
  mtdUph: number | null;
  /** 전월 UPH = 전월 생산량 / 전월 근무시간 합계 */
  prevMonthUph: number | null;
}

export interface ProductionStatusResult {
  asOfDate: string;
  yesterday: string;
  yearMonth: string;
  totalWorkDays: number;
  doneWorkDays: number;
  remainingWorkDays: number;
  /** 진도율(전체) = 작업일수 / 총작업가능일 */
  overallProgressRate: number | null;
  /** 전월 "YYYY-MM" — 생산성(전월 UPH) 계산·표시용 */
  prevYearMonth: string;
  rows: ProductionStatusRow[];
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return toDateStr(new Date(y, m - 1, d + delta));
}
function monthStartOf(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}
function monthEndOf(dateStr: string): string {
  const [y, m] = dateStr.slice(0, 7).split("-").map(Number);
  return `${dateStr.slice(0, 7)}-${pad2(new Date(y, m, 0).getDate())}`;
}
function prevYearMonthOf(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function moldSum(db: DatabaseSync, group: string, dateFrom: string, dateTo: string): number {
  const row = db
    .prepare(
      `SELECT SUM(CAST(json_extract(detail, '$."입고량"') AS REAL)) s FROM mold_receipt_status
       WHERE json_extract(detail, '$."품목군"') = ? AND receipt_date BETWEEN ? AND ?`
    )
    .get(group, dateFrom, dateTo) as { s: number | null };
  return row.s ?? 0;
}

function moldWip(db: DatabaseSync, group: string): number {
  const row = db
    .prepare(
      `SELECT SUM(stock_qty) s FROM inventory_status
       WHERE warehouse = '사출창고' AND json_extract(detail, '$."품목군"') = ?`
    )
    .get(group) as { s: number | null };
  return row.s ?? 0;
}

function processSum(
  db: DatabaseSync,
  processCodes: string[],
  dateFrom: string,
  dateTo: string
): number {
  if (processCodes.length === 0) return 0;
  const placeholders = processCodes.map(() => "?").join(",");
  const row = db
    .prepare(
      `SELECT SUM(CAST(json_extract(detail, '$."양품수량"') AS REAL)) s FROM daily_work_status
       WHERE process_code IN (${placeholders}) AND work_date BETWEEN ? AND ?`
    )
    .get(...processCodes, dateFrom, dateTo) as { s: number | null };
  return row.s ?? 0;
}

// PSN-01 근무시간입력의 실제 근무시간 합계(total_hours) — 라인의 단일 공정코드
// (work_hours_daily.process_code, 그날 작업자 본공정 스냅샷) 기준.
function workHoursSum(db: DatabaseSync, processCode: string, dateFrom: string, dateTo: string): number {
  const row = db
    .prepare(
      `SELECT SUM(total_hours) s FROM work_hours_daily
       WHERE process_code = ? AND work_date BETWEEN ? AND ?`
    )
    .get(processCode, dateFrom, dateTo) as { s: number | null };
  return row.s ?? 0;
}

function headcountOf(db: DatabaseSync, processCode: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) c FROM workers WHERE use_yn = 'Y' AND status = '정상' AND process_code = ?`
      )
      .get(processCode) as { c: number }
  ).c;
}

function processWip(db: DatabaseSync, wipColumnKey: string): number {
  const row = db
    .prepare(`SELECT SUM(json_extract(detail, '$."${wipColumnKey}"')) s FROM process_wip_status`)
    .get() as { s: number | null };
  return row.s ?? 0;
}

export function computeProductionStatus(db: DatabaseSync, asOfDate?: string): ProductionStatusResult {
  const today = asOfDate ?? toDateStr(new Date());
  const yesterday = addDays(today, -1);
  const yearMonth = today.slice(0, 7);
  const monthStart = monthStartOf(today);
  const monthEnd = monthEndOf(today);
  const prevYearMonth = prevYearMonthOf(yearMonth);
  const prevMonthStart = `${prevYearMonth}-01`;
  const prevMonthEnd = monthEndOf(prevMonthStart);

  const totalWorkDays = (
    db
      .prepare(
        `SELECT COUNT(*) c FROM production_calendar WHERE cal_date BETWEEN ? AND ? AND work_yn = 'Y'`
      )
      .get(monthStart, monthEnd) as { c: number }
  ).c;

  const doneWorkDays =
    yesterday < monthStart
      ? 0
      : (
          db
            .prepare(
              `SELECT COUNT(*) c FROM production_calendar WHERE cal_date BETWEEN ? AND ? AND work_yn = 'Y'`
            )
            .get(monthStart, yesterday < monthEnd ? yesterday : monthEnd) as { c: number }
        ).c;

  const remainingWorkDays = Math.max(0, totalWorkDays - doneWorkDays);
  const overallProgressRate = totalWorkDays > 0 ? doneWorkDays / totalWorkDays : null;

  // 월/일 목표생산량은 계획정보(PLAN-02)에서 이미 입력해둔 라인별 일CAPA를 그대로
  // 가져온다(같은 값을 이 화면에 따로 입력하지 않는다) — line_capa_plan은 새로 추가된
  // 테이블이라 이미 떠 있는 서버 프로세스가 모를 수 있어 PLAN-02와 같은 방식으로 매
  // 요청 테이블 존재를 보장한다.
  ensureLineCapaPlanTable(db);
  const dailyCapaRows = db
    .prepare(`SELECT line_key, daily_capa FROM line_capa_plan WHERE year_month = ?`)
    .all(yearMonth) as { line_key: string; daily_capa: number | null }[];
  const dailyCapaByLine = new Map(dailyCapaRows.map((r) => [r.line_key, r.daily_capa]));

  const rows: ProductionStatusRow[] = PRODUCTION_STATUS_LINES.map((line) => {
    // 사출_상/사출_하는 실제로는 같은 사출(P100) 인원이 담당하는 한 라인이라(PLAN-02와
    // 동일 근거) 둘 다 workProcessCode=P100의 인원·근무시간을 같이 쓴다.
    const headcount = headcountOf(db, line.workProcessCode);

    let yesterdayQty: number;
    let mtdQty: number;
    let wip: number;
    let prevMonthQty: number;
    if (line.isMold && line.moldGroup) {
      yesterdayQty = moldSum(db, line.moldGroup, yesterday, yesterday);
      mtdQty = doneWorkDays === 0 ? 0 : moldSum(db, line.moldGroup, monthStart, yesterday);
      wip = moldWip(db, line.moldGroup);
      prevMonthQty = moldSum(db, line.moldGroup, prevMonthStart, prevMonthEnd);
    } else {
      // 실적은 라인 정의의 단일 공정코드(공정명이 정확히 일치하는 것)만 쓴다 — 인원
      // 집계용 PLAN-02 묶음(processCodesByKey)과는 별개.
      const processCodes = line.processCode ? [line.processCode] : [];
      yesterdayQty = processSum(db, processCodes, yesterday, yesterday);
      mtdQty = doneWorkDays === 0 ? 0 : processSum(db, processCodes, monthStart, yesterday);
      wip = processWip(db, line.wipColumnKey ?? "");
      prevMonthQty = processSum(db, processCodes, prevMonthStart, prevMonthEnd);
    }

    const dailyTarget = dailyCapaByLine.get(line.key) ?? null;
    const monthlyTarget = dailyTarget != null ? dailyTarget * totalWorkDays : null;
    const shortage = dailyTarget != null ? yesterdayQty - dailyTarget : null;
    const achievementRate = dailyTarget != null && dailyTarget > 0 ? yesterdayQty / dailyTarget : null;
    const progressRate =
      monthlyTarget != null && monthlyTarget > 0 ? mtdQty / monthlyTarget : null;
    const progressGap =
      progressRate != null && overallProgressRate != null ? progressRate - overallProgressRate : null;
    const cumulativeShortage =
      monthlyTarget != null && overallProgressRate != null
        ? mtdQty - monthlyTarget * overallProgressRate
        : null;

    const code = line.workProcessCode;
    const yesterdayHours = workHoursSum(db, code, yesterday, yesterday);
    const mtdHours = doneWorkDays === 0 ? 0 : workHoursSum(db, code, monthStart, yesterday);
    const prevMonthHours = workHoursSum(db, code, prevMonthStart, prevMonthEnd);
    const yesterdayUph = yesterdayHours > 0 ? yesterdayQty / yesterdayHours : null;
    const mtdUph = mtdHours > 0 ? mtdQty / mtdHours : null;
    const prevMonthUph = prevMonthHours > 0 ? prevMonthQty / prevMonthHours : null;

    return {
      key: line.key,
      label: line.label,
      isMold: line.isMold,
      headcount,
      monthlyTarget,
      dailyTarget,
      yesterdayQty,
      mtdQty,
      wip,
      shortage,
      achievementRate,
      progressRate,
      progressGap,
      cumulativeShortage,
      yesterdayUph,
      mtdUph,
      prevMonthUph,
    };
  });

  return {
    asOfDate: today,
    yesterday,
    yearMonth,
    totalWorkDays,
    doneWorkDays,
    remainingWorkDays,
    overallProgressRate,
    prevYearMonth,
    rows,
  };
}

export interface ProductionTrendPoint {
  label: string;
  /** 생산성(UPH) = 생산수량 ÷ PSN-01 근무시간 합계 — 2026-09-28 사용자 요청으로 그래프를
   *  생산수량 대신 생산성으로 바꿨다. 표 상단 요약의 yesterdayUph/mtdUph와 같은 산식. */
  uph: number;
}
export interface ProductionTrendResult {
  lineKey: string;
  label: string;
  points: ProductionTrendPoint[];
  average: number;
  /** 기준정보(BASE-04) 공정별 목표 UPH — 기준일 연도의 값(없으면 직전 연도 값), 미등록이면 null */
  targetUph: number | null;
}

function monthLabelOf(ym: string): string {
  return `${Number(ym.slice(5, 7))}월`;
}
function dayLabelOf(dateStr: string): string {
  return `${Number(dateStr.slice(5, 7))}/${Number(dateStr.slice(8, 10))}`;
}

// MGMT-05 표 하단 그래프 — 선택한 라인의 올해 1월~전월은 월별 합계, 이번달은 1일~전일까지
// 일별 실적을 이어 붙인 추이(그래프.JPG 참고: 월별 추이 뒤에 이번달 일별 실적이 붙는 형태).
export function computeProductionTrend(
  db: DatabaseSync,
  lineKey: string,
  asOfDate?: string
): ProductionTrendResult {
  const line = PRODUCTION_STATUS_LINES.find((l) => l.key === lineKey);
  if (!line) throw new Error(`알 수 없는 공정입니다: ${lineKey}`);

  const today = asOfDate ?? toDateStr(new Date());
  const yesterday = addDays(today, -1);
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const monthStart = monthStartOf(today);

  // 생산성(UPH) 분모 = PSN-01 실제 근무시간 합계(표 상단 요약의 yesterdayUph·mtdUph와 같은
  // 기준: 라인의 단일 workProcessCode, 사출_하는 사출_상과 같은 P100). 월별 점은 그 달,
  // 일별 점은 그 날의 합계로 나눈다. 근무시간 기록이 없는 달/날은 UPH를 만들 근거가
  // 없어 0으로 그리지 않고 점 자체를 건너뛴다(PSN-01 데이터가 시작되기 전 달 등). 생산량이
  // 0이라 UPH가 0인 점도 같은 이유로 제외한다(2026-09-28 사용자 요청) — 평균도 나머지 점 기준.
  const hoursByYm = new Map(
    (
      db
        .prepare(
          `SELECT substr(work_date, 1, 7) ym, SUM(total_hours) s FROM work_hours_daily
           WHERE process_code = ? AND work_date >= ? AND work_date < ? GROUP BY ym`
        )
        .all(line.workProcessCode, yearStart, monthStart) as { ym: string; s: number | null }[]
    ).map((r) => [r.ym, r.s ?? 0])
  );
  const hoursByDate = new Map(
    (
      db
        .prepare(
          `SELECT work_date d, SUM(total_hours) s FROM work_hours_daily
           WHERE process_code = ? AND work_date BETWEEN ? AND ? GROUP BY d`
        )
        .all(line.workProcessCode, monthStart, yesterday) as { d: string; s: number | null }[]
    ).map((r) => [r.d, r.s ?? 0])
  );

  const points: ProductionTrendPoint[] = [];
  const pushPoint = (label: string, qty: number, hours: number | undefined): void => {
    if (hours == null || hours <= 0) return;
    const uph = qty / hours;
    if (uph > 0) points.push({ label, uph });
  };

  if (line.isMold && line.moldGroup) {
    const group = line.moldGroup;
    const monthRows = db
      .prepare(
        `SELECT substr(receipt_date, 1, 7) ym, SUM(CAST(json_extract(detail, '$."입고량"') AS REAL)) s
         FROM mold_receipt_status
         WHERE json_extract(detail, '$."품목군"') = ? AND receipt_date >= ? AND receipt_date < ?
         GROUP BY ym ORDER BY ym`
      )
      .all(group, yearStart, monthStart) as { ym: string; s: number | null }[];
    for (const r of monthRows) {
      pushPoint(monthLabelOf(r.ym), r.s ?? 0, hoursByYm.get(r.ym));
    }

    if (yesterday >= monthStart) {
      const dayRows = db
        .prepare(
          `SELECT receipt_date d, SUM(CAST(json_extract(detail, '$."입고량"') AS REAL)) s
           FROM mold_receipt_status
           WHERE json_extract(detail, '$."품목군"') = ? AND receipt_date BETWEEN ? AND ?
           GROUP BY d ORDER BY d`
        )
        .all(group, monthStart, yesterday) as { d: string; s: number | null }[];
      const byDate = new Map(dayRows.map((r) => [r.d, r.s ?? 0]));
      for (let d = monthStart; d <= yesterday; d = addDays(d, 1)) {
        pushPoint(dayLabelOf(d), byDate.get(d) ?? 0, hoursByDate.get(d));
      }
    }
  } else if (line.processCode) {
    const processCode = line.processCode;
    const monthRows = db
      .prepare(
        `SELECT substr(work_date, 1, 7) ym, SUM(CAST(json_extract(detail, '$."양품수량"') AS REAL)) s
         FROM daily_work_status
         WHERE process_code = ? AND work_date >= ? AND work_date < ?
         GROUP BY ym ORDER BY ym`
      )
      .all(processCode, yearStart, monthStart) as { ym: string; s: number | null }[];
    for (const r of monthRows) {
      pushPoint(monthLabelOf(r.ym), r.s ?? 0, hoursByYm.get(r.ym));
    }

    if (yesterday >= monthStart) {
      const dayRows = db
        .prepare(
          `SELECT work_date d, SUM(CAST(json_extract(detail, '$."양품수량"') AS REAL)) s
           FROM daily_work_status
           WHERE process_code = ? AND work_date BETWEEN ? AND ?
           GROUP BY d ORDER BY d`
        )
        .all(processCode, monthStart, yesterday) as { d: string; s: number | null }[];
      const byDate = new Map(dayRows.map((r) => [r.d, r.s ?? 0]));
      for (let d = monthStart; d <= yesterday; d = addDays(d, 1)) {
        pushPoint(dayLabelOf(d), byDate.get(d) ?? 0, hoursByDate.get(d));
      }
    }
  }

  const vals = points.map((p) => p.uph);
  const average = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;

  const targetUph = getProcessUphTarget(db, line.key, Number(today.slice(0, 4)))?.targetUph ?? null;

  return { lineKey: line.key, label: line.label, points, average, targetUph };
}

// MGMT-05 기준일 기본값 — 공정(라인)별로 "실적이 있는 마지막 날짜" 중 가장 이른 날짜(= 모든
// 공정에 실적이 들어와 있는 마지막 날)의 다음날. 화면은 "전일 실적"을 보여주므로 기준일을 그
// 다음날로 두면 전일이 곧 그 날짜가 된다(2026-09-28 사용자 요청: 9/23까지 실적이 있으면 기본
// 9/24). 일부 공정에만 특근 실적이 더 있어도(예: 일요일 착색/마킹) 나머지 공정이 0으로 뜨는
// 화면이 기본값이 되지 않게 최소값을 쓴다. 실적이 하나도 없으면 오늘, 미래로는 넘기지 않는다.
export function computeDefaultAsOfDate(db: DatabaseSync): string {
  const latestDates: string[] = [];
  for (const line of PRODUCTION_STATUS_LINES) {
    let row: { d: string | null };
    if (line.isMold && line.moldGroup) {
      row = db
        .prepare(
          `SELECT MAX(receipt_date) d FROM mold_receipt_status
           WHERE json_extract(detail, '$."품목군"') = ? AND CAST(json_extract(detail, '$."입고량"') AS REAL) > 0`
        )
        .get(line.moldGroup) as { d: string | null };
    } else if (line.processCode) {
      row = db
        .prepare(
          `SELECT MAX(work_date) d FROM daily_work_status
           WHERE process_code = ? AND CAST(json_extract(detail, '$."양품수량"') AS REAL) > 0`
        )
        .get(line.processCode) as { d: string | null };
    } else continue;
    if (row.d) latestDates.push(row.d);
  }
  const todayStr = toDateStr(new Date());
  if (latestDates.length === 0) return todayStr;
  const next = addDays(latestDates.reduce((a, b) => (a < b ? a : b)), 1);
  return next < todayStr ? next : todayStr;
}
