import type { DatabaseSync } from "node:sqlite";
import type { CalendarDayType } from "@/lib/types";
import { ENTITY_TYPE_WORKER, fetchFieldHistoryMap, resolveFieldAsOf } from "@/lib/master-data-history";

// 인원관리(PSN-05) "근무시간조회" — PSN-01(일일근태입력)에 저장된 근태기록을 공정 기준으로
// 조회기간 내 일자별로 쭉 나열하는 조회 전용 화면(2026-09-07: 처음엔 작업자 1명만 보여주다,
// "공정별 기준으로 보여달라"는 요청으로 공정 소속 작업자 전원을 한 번에 보여주도록 바뀜 —
// 사번/성명 검색은 이제 그 안에서 한 명만 추려낼 때 쓰는 보조 필터). 새로 입력하지 않고
// work_hours_daily/work_support_detail에 이미 저장된 값만 읽는다 — normal_hours는 저장
// 시점에 이미 work-hours-leave.ts의 normalHoursFor 공식으로 계산돼 있으니 여기서 다시
// 계산하지 않고 그대로 쓴다. route.ts(화면 조회)와 export/route.ts(엑셀 다운로드)가 이
// 헬퍼를 공유한다.

export const MAX_LOOKUP_DAYS = 366;
// 엑셀 다운로드(export/route.ts)는 한 번에 전체를 파일로 뽑아야 해서 페이지네이션이
// 의미가 없다 — 작업자 수 × 조회일수가 이 값을 넘으면 그냥 막는다(2026-09-08: 화면
// 조회는 더 이상 이 값으로 막지 않고 PAGE_ROW_LIMIT 기준으로 인원별 페이지네이션한다).
export const MAX_LOOKUP_CELLS = 6000;
// 화면 조회(route.ts) 1페이지당 셀 수(작업자 수 × 조회일수) 상한 — 이 값을 넘으면
// 인원 단위로 페이지를 나눈다("조회 범위를 좁혀주세요" 안내와 함께, 2026-09-08 사용자
// 요청). 조회일수가 짧으면 한 페이지에 더 많은 인원이, 조회일수가 길면 더 적은 인원이
// 들어간다 — 어느 조합이든 화면에 한 번에 그려지는 행 수는 이 값 근처로 유지된다.
export const PAGE_ROW_LIMIT = 500;

export interface WorkHoursLookupRow {
  work_date: string;
  total_hours: number;
  normal_hours: number;
  overtime_hours: number;
  early_start_hours: number;
  lunch_shift_hours: number;
  late_hours: number;
  early_leave_hours: number;
  outing_hours: number;
  support_hours: number;
  has_record: boolean;
}

export interface WorkHoursLookupTotals {
  total_hours: number;
  normal_hours: number;
  overtime_hours: number;
  early_start_hours: number;
  lunch_shift_hours: number;
  late_hours: number;
  early_leave_hours: number;
  outing_hours: number;
  support_hours: number;
}

export interface WorkHoursLookupWorkerBlock {
  employee_no: string;
  worker_name: string;
  work_group: string | null;
  contractor: string | null;
  /** "비즈" 원본 사번·부서(없으면 null) — PSN-05 "초과신청" 다운로드에서 사번/공정
   *  대신 이 값을 우선 쓴다(export-overtime/route.ts 참고). */
  biz_employee_no: string | null;
  biz_dept: string | null;
  rows: WorkHoursLookupRow[];
  totals: WorkHoursLookupTotals;
}

export interface WorkHoursLookupResult {
  dateFrom: string;
  dateTo: string;
  workers: WorkHoursLookupWorkerBlock[];
  grandTotals: WorkHoursLookupTotals;
  // 생산캘린더(BASE-08)에 등록된 날짜만 담는다(미등록 날짜는 빠짐) — 화면에서 토/일요일은
  // 요일 계산으로, 휴일은 이 맵(day_type='휴일')으로 판단해 일자 글씨색을 구분한다.
  calendar: Record<string, CalendarDayType>;
}

// route.ts(화면 조회)가 내려주는 응답 — workers는 현재 페이지(인원 단위)만 담고,
// grandTotals는 페이지에 관계없이 조건에 맞는 전체 인원 기준으로 별도 집계한다
// (fetchGrandTotals 참고, 그래서 "전체합계"가 페이지를 넘겨도 항상 같은 값을 보여준다).
export interface WorkHoursLookupPage extends WorkHoursLookupResult {
  totalWorkers: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// dateFrom~dateTo(포함) 사이 모든 날짜를 "YYYY-MM-DD" 문자열로 나열한다. work_date가
// 문자열로 저장되어 있어 날짜 계산은 UTC 기준으로 해도 달력 날짜 자체는 어긋나지 않는다.
export function dateRange(dateFrom: string, dateTo: string): string[] {
  const out: string[] = [];
  const start = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);
  for (let d = start; d.getTime() <= end.getTime(); d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function emptyTotals(): WorkHoursLookupTotals {
  return {
    total_hours: 0,
    normal_hours: 0,
    overtime_hours: 0,
    early_start_hours: 0,
    lunch_shift_hours: 0,
    late_hours: 0,
    early_leave_hours: 0,
    outing_hours: 0,
    support_hours: 0,
  };
}

function addInto(target: WorkHoursLookupTotals, src: WorkHoursLookupTotals) {
  target.total_hours += src.total_hours;
  target.normal_hours += src.normal_hours;
  target.overtime_hours += src.overtime_hours;
  target.early_start_hours += src.early_start_hours;
  target.lunch_shift_hours += src.lunch_shift_hours;
  target.late_hours += src.late_hours;
  target.early_leave_hours += src.early_leave_hours;
  target.outing_hours += src.outing_hours;
  target.support_hours += src.support_hours;
}

// employeeNo(특정 1명 지정) 또는 workGroup(그 공정 소속 전원) 기준으로 조회 대상 사번
// 목록을 구한다. 조장 세션(leaderWorkGroups)이 있으면 그 소속공정 밖은 결과에서 빠진다
// (권한 밖 요청이어도 에러 대신 그냥 빈 목록 — /api/workers의 조장 스코프 방식과 동일).
export function resolveEmployeeNos(
  db: DatabaseSync,
  params: { workGroup: string; employeeNo: string; leaderWorkGroups: string[] | null }
): string[] {
  if (params.employeeNo) {
    const w = db
      .prepare("SELECT employee_no, work_group FROM workers WHERE employee_no = ?")
      .get(params.employeeNo) as { employee_no: string; work_group: string | null } | undefined;
    if (!w) return [];
    if (params.leaderWorkGroups && !params.leaderWorkGroups.includes(w.work_group ?? "")) return [];
    return [w.employee_no];
  }

  let groups: string[] | null = params.leaderWorkGroups;
  if (params.workGroup) {
    if (groups && !groups.includes(params.workGroup)) return [];
    groups = [params.workGroup];
  }

  if (!groups) {
    const rows = db.prepare("SELECT employee_no FROM workers ORDER BY seq, employee_no").all() as {
      employee_no: string;
    }[];
    return rows.map((r) => r.employee_no);
  }
  if (groups.length === 0) return [];
  const placeholders = groups.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT employee_no FROM workers WHERE work_group IN (${placeholders}) ORDER BY seq, employee_no`)
    .all(...groups) as { employee_no: string }[];
  return rows.map((r) => r.employee_no);
}

export function fetchWorkHoursLookup(
  db: DatabaseSync,
  params: { employeeNos: string[]; dateFrom: string; dateTo: string }
): WorkHoursLookupResult {
  const dates = dateRange(params.dateFrom, params.dateTo);
  const grandTotals = emptyTotals();

  const calendarRows = db
    .prepare("SELECT cal_date, day_type FROM production_calendar WHERE cal_date BETWEEN ? AND ?")
    .all(params.dateFrom, params.dateTo) as { cal_date: string; day_type: CalendarDayType }[];
  const calendar: Record<string, CalendarDayType> = Object.fromEntries(
    calendarRows.map((r) => [r.cal_date, r.day_type])
  );

  if (params.employeeNos.length === 0) {
    return { dateFrom: params.dateFrom, dateTo: params.dateTo, workers: [], grandTotals, calendar };
  }

  const placeholders = params.employeeNos.map(() => "?").join(",");
  const workerRows = db
    .prepare(
      `SELECT employee_no, worker_name, work_group, contractor, biz_employee_no, biz_dept
       FROM workers WHERE employee_no IN (${placeholders}) ORDER BY seq, employee_no`
    )
    .all(...params.employeeNos) as {
    employee_no: string;
    worker_name: string;
    work_group: string | null;
    contractor: string | null;
    biz_employee_no: string | null;
    biz_dept: string | null;
  }[];

  const dailyRows = db
    .prepare(
      `SELECT employee_no, work_date, total_hours, normal_hours, overtime_hours, early_start_hours,
              lunch_shift_hours, late_hours, early_leave_hours, outing_hours
       FROM work_hours_daily WHERE employee_no IN (${placeholders}) AND work_date BETWEEN ? AND ?`
    )
    .all(...params.employeeNos, params.dateFrom, params.dateTo) as {
    employee_no: string;
    work_date: string;
    total_hours: number;
    normal_hours: number;
    overtime_hours: number;
    early_start_hours: number;
    lunch_shift_hours: number;
    late_hours: number;
    early_leave_hours: number;
    outing_hours: number;
  }[];
  const dailyByKey = new Map(dailyRows.map((r) => [`${r.employee_no}|${r.work_date}`, r]));

  const supportRows = db
    .prepare(
      `SELECT employee_no, work_date, support_hours FROM work_support_detail
       WHERE employee_no IN (${placeholders}) AND work_date BETWEEN ? AND ?`
    )
    .all(...params.employeeNos, params.dateFrom, params.dateTo) as {
    employee_no: string;
    work_date: string;
    support_hours: number;
  }[];
  const supportByKey = new Map(supportRows.map((r) => [`${r.employee_no}|${r.work_date}`, r.support_hours]));

  // 공정(work_group)은 작업자 변경이력(BASE-10)을 참조해 조회기간 종료일(dateTo) 기준
  // "그 당시 값"을 보여준다(2026-09-09 사용자 요청) — workers의 현재값을 그대로 보여주면
  // 과거 기간을 조회할 때 지금 소속으로 잘못 표시될 수 있다. 화면이 작업자당 공정을 한
  // 값만 보여주는 구조(일자별로 다시 나누지 않음)라 dateTo를 기준일로 쓴다.
  const workGroupHistory = fetchFieldHistoryMap(db, ENTITY_TYPE_WORKER, "work_group", params.employeeNos);

  const workers: WorkHoursLookupWorkerBlock[] = workerRows.map((w) => {
    const totals = emptyTotals();
    const rows: WorkHoursLookupRow[] = dates.map((workDate) => {
      const key = `${w.employee_no}|${workDate}`;
      const d = dailyByKey.get(key);
      const supportHours = supportByKey.get(key) ?? 0;
      const row: WorkHoursLookupRow = {
        work_date: workDate,
        total_hours: d?.total_hours ?? 0,
        normal_hours: d?.normal_hours ?? 0,
        overtime_hours: d?.overtime_hours ?? 0,
        early_start_hours: d?.early_start_hours ?? 0,
        lunch_shift_hours: d?.lunch_shift_hours ?? 0,
        late_hours: d?.late_hours ?? 0,
        early_leave_hours: d?.early_leave_hours ?? 0,
        outing_hours: d?.outing_hours ?? 0,
        support_hours: supportHours,
        has_record: d != null,
      };
      addInto(totals, row);
      return row;
    });
    addInto(grandTotals, totals);
    return {
      employee_no: w.employee_no,
      worker_name: w.worker_name,
      work_group: resolveFieldAsOf(workGroupHistory, w.employee_no, params.dateTo, w.work_group),
      contractor: w.contractor,
      biz_employee_no: w.biz_employee_no,
      biz_dept: w.biz_dept,
      rows,
      totals,
    };
  });

  return { dateFrom: params.dateFrom, dateTo: params.dateTo, workers, grandTotals, calendar };
}

export interface SpecialWorkDayTotal {
  employee_no: string;
  worker_name: string;
  /** 선택한 특근일 중 실제 근무기록(total_hours>0)이 있었던 일수 */
  base_days: number;
  /** 그 날들의 min(total_hours, 8) 합계 */
  base_hours: number;
  /** 선택한 특근일 중 8시간을 넘겨 일한(연장 발생) 일수 */
  overtime_days: number;
  /** 그 날들의 max(total_hours - 8, 0) 합계 */
  overtime_hours: number;
}

// PSN-05 "특근일" 기능(2026-09-08 사용자 요청) — 조회기간처럼 연속된 구간이 아니라,
// 달력에서 임의로 골라낸 날짜 목록(비연속 가능) 기준으로 PSN-01에 저장된 실제
// work_hours_daily.total_hours를 사람별로 합산한다. fetchWorkHoursLookup은 dateRange()로
// 연속 구간을 가정하므로 이 용도로는 못 쓰고, 이 함수를 따로 둔다.
export function fetchSpecialWorkDayTotals(
  db: DatabaseSync,
  params: { employeeNos: string[]; dates: string[] }
): SpecialWorkDayTotal[] {
  if (params.employeeNos.length === 0 || params.dates.length === 0) return [];

  const empPh = params.employeeNos.map(() => "?").join(",");
  const workerRows = db
    .prepare(
      `SELECT employee_no, worker_name FROM workers WHERE employee_no IN (${empPh}) ORDER BY seq, employee_no`
    )
    .all(...params.employeeNos) as { employee_no: string; worker_name: string }[];

  const datePh = params.dates.map(() => "?").join(",");
  const dailyRows = db
    .prepare(
      `SELECT employee_no, total_hours FROM work_hours_daily
       WHERE employee_no IN (${empPh}) AND work_date IN (${datePh})`
    )
    .all(...params.employeeNos, ...params.dates) as { employee_no: string; total_hours: number }[];

  const byEmployee = new Map<string, number[]>();
  for (const r of dailyRows) {
    if (!byEmployee.has(r.employee_no)) byEmployee.set(r.employee_no, []);
    byEmployee.get(r.employee_no)!.push(r.total_hours);
  }

  return workerRows.map((w) => {
    const hoursList = byEmployee.get(w.employee_no) ?? [];
    let base_days = 0;
    let base_hours = 0;
    let overtime_days = 0;
    let overtime_hours = 0;
    for (const total of hoursList) {
      const base = Math.min(total, 8);
      const overtime = Math.max(total - 8, 0);
      if (base > 0) {
        base_days++;
        base_hours += base;
      }
      if (overtime > 0) {
        overtime_days++;
        overtime_hours += overtime;
      }
    }
    return { employee_no: w.employee_no, worker_name: w.worker_name, base_days, base_hours, overtime_days, overtime_hours };
  });
}

// 페이지네이션과 무관하게 "조건에 맞는 전체 인원" 기준 합계를 SQL SUM으로 바로 구한다
// (JS로 매 인원의 rows를 만들어 더하는 fetchWorkHoursLookup의 grandTotals는 현재
// 페이지 인원만 반영하므로, 전체합계 표시용으로는 이 함수를 따로 쓴다).
export function fetchGrandTotals(
  db: DatabaseSync,
  params: { employeeNos: string[]; dateFrom: string; dateTo: string }
): WorkHoursLookupTotals {
  if (params.employeeNos.length === 0) return emptyTotals();
  const placeholders = params.employeeNos.map(() => "?").join(",");
  const daily = db
    .prepare(
      `SELECT
         COALESCE(SUM(total_hours), 0) AS total_hours,
         COALESCE(SUM(normal_hours), 0) AS normal_hours,
         COALESCE(SUM(overtime_hours), 0) AS overtime_hours,
         COALESCE(SUM(early_start_hours), 0) AS early_start_hours,
         COALESCE(SUM(lunch_shift_hours), 0) AS lunch_shift_hours,
         COALESCE(SUM(late_hours), 0) AS late_hours,
         COALESCE(SUM(early_leave_hours), 0) AS early_leave_hours,
         COALESCE(SUM(outing_hours), 0) AS outing_hours
       FROM work_hours_daily
       WHERE employee_no IN (${placeholders}) AND work_date BETWEEN ? AND ?`
    )
    .get(...params.employeeNos, params.dateFrom, params.dateTo) as Omit<
    WorkHoursLookupTotals,
    "support_hours"
  >;
  const support = db
    .prepare(
      `SELECT COALESCE(SUM(support_hours), 0) AS support_hours FROM work_support_detail
       WHERE employee_no IN (${placeholders}) AND work_date BETWEEN ? AND ?`
    )
    .get(...params.employeeNos, params.dateFrom, params.dateTo) as { support_hours: number };
  return { ...daily, support_hours: support.support_hours };
}
