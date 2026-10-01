import type { DatabaseSync } from "node:sqlite";
import { ensureBizAttendanceTable } from "@/lib/biz-attendance";
import { dateRange } from "@/lib/work-hours-lookup";
import {
  BIZ_AUDIT_ITEM_KEYS,
  BIZ_AUDIT_TOLERANCE_MIN,
  type BizAuditItem,
  type BizAuditItemKey,
  type BizAuditResult,
  type BizAuditRow,
  type BizAuditStatus,
  type BizAuditSummary,
} from "@/lib/biz-audit-shared";

export * from "@/lib/biz-audit-shared";

// 인원관리(PSN-06) "비즈 대사" 탭 — PSN-05 비즈 탭에 올려 둔 비즈 "기간별 근무관리" 데이터를 MES
// (PSN-01 일일근태입력 저장값)와 사번+일자로 맞춰 대조한다(2026-10-01 사용자 요청). 비즈 사번은
// 작업자등록(BASE-09)의 비즈 사번(workers.biz_employee_no)으로 MES 사번에 연결한다.
//
// 두 시스템은 같은 시간을 다른 칸에 적는 경우가 있어 그대로 비교하면 구조 차이가 전부 불일치로
// 뜬다 — 그래서 아래 기준으로 정규화해 비교한다(모두 분 단위).
//  - 정근: 비즈 정근 + 특근  ↔  MES 정상 + 지원(8시간 한도). 비즈는 휴일 근무를 "특근" 칸에 적고
//    MES는 "정상"에 적으며, MES는 다른 공정 지원시간을 정상에서 빼서 따로 적는다.
//  - 연장: 비즈 연장 + 특연(휴일/토요)  ↔  MES 잔업 + 조출 + 중교 + 지원 초과분(8시간 넘는 지원).
//  - 지각, 조퇴: 그대로.
// 허용 오차는 10분(10분 단위로 입력하는 값이라 이 이하는 같은 값으로 본다).

/** 비즈 데이터가 이 비율 미만으로 적게 들어온 마지막 구간(아직 비즈에 안 올라온 최근 일자)은 비교에서 뺀다 */
const COVERAGE_RATIO = 0.5;
const COVERAGE_MIN_ROWS = 10;

interface WorkerLite {
  employee_no: string;
  biz_employee_no: string;
  worker_name: string;
  work_group: string | null;
}

interface DailyLite {
  employee_no: string;
  work_date: string;
  leave_type: string | null;
  normal_hours: number;
  overtime_hours: number;
  early_start_hours: number;
  lunch_shift_hours: number;
  late_hours: number;
  early_leave_hours: number;
  total_hours: number;
}

interface BizRowDb {
  employee_no: string;
  dept: string | null;
  worker_name: string | null;
  shift: string | null;
  work_date: string;
  in_time: string | null;
  out_time: string | null;
  late_min: number | null;
  early_leave_min: number | null;
  normal_min: number | null;
  extension_min: number | null;
  special_min: number | null;
  special_holiday_min: number | null;
  special_sat_min: number | null;
  note: string | null;
}

const toMin = (h: number | null | undefined): number => Math.round((h ?? 0) * 60);
const n = (v: number | null | undefined): number => v ?? 0;

function makeItem(biz: number, mes: number): BizAuditItem {
  const diff = mes - biz;
  return { biz, mes, diff, mismatch: Math.abs(diff) > BIZ_AUDIT_TOLERANCE_MIN };
}

export function fetchBizAudit(
  db: DatabaseSync,
  params: { dateFrom: string; dateTo: string; workGroup: string; q: string; leaderWorkGroups: string[] | null }
): BizAuditResult {
  ensureBizAttendanceTable(db);
  const { dateFrom, dateTo } = params;

  const emptySummary = (): BizAuditSummary => ({
    comparedRows: 0,
    matchRows: 0,
    mismatchRows: 0,
    bizOnlyRows: 0,
    mesOnlyRows: 0,
    matchRate: null,
    byItem: { normal: 0, extension: 0, late: 0, early_leave: 0 },
    byCause: [],
    excludedDates: [],
    unmatchedPersons: [],
    bizFrom: null,
    bizTo: null,
  });

  const range = db.prepare("SELECT MIN(work_date) a, MAX(work_date) b FROM biz_attendance").get() as {
    a: string | null;
    b: string | null;
  };
  const base = emptySummary();
  base.bizFrom = range.a;
  base.bizTo = range.b;
  if (params.leaderWorkGroups && params.leaderWorkGroups.length === 0) {
    return { dateFrom, dateTo, rows: [], summary: base };
  }

  // 비즈 사번 → MES 작업자
  const workers = db
    .prepare(
      "SELECT employee_no, biz_employee_no, worker_name, work_group FROM workers WHERE biz_employee_no IS NOT NULL AND biz_employee_no != ''"
    )
    .all() as unknown as WorkerLite[];
  const workerByBiz = new Map(workers.map((w) => [w.biz_employee_no, w]));

  const bizRows = db
    .prepare(
      `SELECT employee_no, dept, worker_name, shift, work_date, in_time, out_time, late_min, early_leave_min,
              normal_min, extension_min, special_min, special_holiday_min, special_sat_min, note
       FROM biz_attendance WHERE work_date BETWEEN ? AND ? ORDER BY id`
    )
    .all(dateFrom, dateTo) as unknown as BizRowDb[];

  const q = params.q.trim().toLowerCase();
  const scoped = (w: WorkerLite): boolean => {
    if (params.leaderWorkGroups && !params.leaderWorkGroups.includes(w.work_group ?? "")) return false;
    if (params.workGroup && w.work_group !== params.workGroup) return false;
    return true;
  };

  // 연결 안 되는 비즈 인원(사무직 등) — 공정/조장 범위를 좁힌 조회에서는 어느 공정인지 알 수 없어 생략
  const unmatched = new Map<string, { biz_no: string; name: string | null; dept: string | null; days: number }>();
  if (!params.workGroup && !params.leaderWorkGroups) {
    for (const b of bizRows) {
      if (workerByBiz.has(b.employee_no)) continue;
      const u = unmatched.get(b.employee_no) ?? { biz_no: b.employee_no, name: b.worker_name, dept: b.dept, days: 0 };
      u.days++;
      unmatched.set(b.employee_no, u);
    }
  }

  // 비교 대상 비즈 행(작업자 연결 + 범위)
  const bizByKey = new Map<string, { b: BizRowDb; w: WorkerLite }>();
  for (const b of bizRows) {
    const w = workerByBiz.get(b.employee_no);
    if (!w || !scoped(w)) continue;
    bizByKey.set(`${w.employee_no}|${b.work_date}`, { b, w });
  }
  // 비즈에 한 줄도 없어도 MES에만 있는 날을 찾아야 하므로, 비즈 사번이 연결된 작업자 전체를 MES 쪽 대상으로 둔다
  const mesNos = workers.filter(scoped).map((w) => w.employee_no);

  const mesBy = new Map<string, DailyLite>();
  const supportBy = new Map<string, number>();
  if (mesNos.length > 0) {
    const ph = mesNos.map(() => "?").join(",");
    const dailies = db
      .prepare(
        `SELECT employee_no, work_date, leave_type, normal_hours, overtime_hours, early_start_hours, lunch_shift_hours,
                late_hours, early_leave_hours, total_hours
         FROM work_hours_daily WHERE work_date BETWEEN ? AND ? AND employee_no IN (${ph})`
      )
      .all(dateFrom, dateTo, ...mesNos) as unknown as DailyLite[];
    for (const d of dailies) mesBy.set(`${d.employee_no}|${d.work_date}`, d);
    const sup = db
      .prepare(
        `SELECT employee_no, work_date, SUM(support_hours) s FROM work_support_detail
         WHERE work_date BETWEEN ? AND ? AND employee_no IN (${ph}) GROUP BY employee_no, work_date`
      )
      .all(dateFrom, dateTo, ...mesNos) as { employee_no: string; work_date: string; s: number }[];
    for (const s of sup) supportBy.set(`${s.employee_no}|${s.work_date}`, s.s);
  }

  const bizWorked = (b: BizRowDb): boolean =>
    !!(b.in_time || b.out_time) ||
    n(b.normal_min) + n(b.special_min) + n(b.extension_min) + n(b.special_holiday_min) + n(b.special_sat_min) > 0;
  const mesWorked = (d: DailyLite | undefined, sup: number): boolean => !!d && (d.total_hours > 0 || d.normal_hours > 0 || sup > 0);

  // 비즈에 아직 올라오지 않은 최근 일자(마지막으로 비즈가 충분히 채워진 날 이후)는 비교에서 뺀다
  const dates = dateRange(dateFrom, dateTo);
  const bizCount = new Map<string, number>();
  const mesCount = new Map<string, number>();
  for (const { b } of bizByKey.values()) if (bizWorked(b)) bizCount.set(b.work_date, (bizCount.get(b.work_date) ?? 0) + 1);
  for (const [k, d] of mesBy) {
    if (mesWorked(d, supportBy.get(k) ?? 0)) mesCount.set(d.work_date, (mesCount.get(d.work_date) ?? 0) + 1);
  }
  let lastGood: string | null = null;
  for (const dt of dates) {
    const bz = bizCount.get(dt) ?? 0;
    const ms = mesCount.get(dt) ?? 0;
    if (bz >= COVERAGE_MIN_ROWS && bz >= ms * COVERAGE_RATIO) lastGood = dt;
  }
  const excluded = new Set<string>();
  const excludedDates: BizAuditSummary["excludedDates"] = [];
  if (lastGood) {
    for (const dt of dates) {
      if (dt > lastGood && (mesCount.get(dt) ?? 0) + (bizCount.get(dt) ?? 0) > 0) {
        excluded.add(dt);
        excludedDates.push({ date: dt, bizRows: bizCount.get(dt) ?? 0, mesRows: mesCount.get(dt) ?? 0 });
      }
    }
  }

  const workerByEmp = new Map(workers.map((w) => [w.employee_no, w]));
  const keys = new Set<string>([...bizByKey.keys(), ...mesBy.keys()]);
  const rows: BizAuditRow[] = [];
  const causeCount = new Map<string, number>();
  const byItem: Record<BizAuditItemKey, number> = { normal: 0, extension: 0, late: 0, early_leave: 0 };
  let matchRows = 0;
  let mismatchRows = 0;
  let bizOnlyRows = 0;
  let mesOnlyRows = 0;

  for (const key of keys) {
    const [empNo, workDate] = key.split("|");
    if (excluded.has(workDate)) continue;
    const w = workerByEmp.get(empNo);
    if (!w || !scoped(w)) continue;
    if (q && !w.employee_no.toLowerCase().includes(q) && !w.biz_employee_no.includes(q) && !w.worker_name.toLowerCase().includes(q)) continue;

    const bz = bizByKey.get(key)?.b;
    const ms = mesBy.get(key);
    const sup = supportBy.get(key) ?? 0;
    const bizHas = !!bz && bizWorked(bz);
    const mesHas = mesWorked(ms, sup);
    if (!bizHas && !mesHas) continue; // 양쪽 다 근무 없음(휴무/연차 0시간 행)

    const supNormal = Math.min(sup, 8);
    const supExtra = Math.max(0, sup - 8);
    const items: Record<BizAuditItemKey, BizAuditItem> = {
      normal: makeItem(n(bz?.normal_min) + n(bz?.special_min), toMin((ms?.normal_hours ?? 0) + supNormal)),
      extension: makeItem(
        n(bz?.extension_min) + n(bz?.special_holiday_min) + n(bz?.special_sat_min),
        toMin((ms?.overtime_hours ?? 0) + (ms?.early_start_hours ?? 0) + (ms?.lunch_shift_hours ?? 0) + supExtra)
      ),
      late: makeItem(n(bz?.late_min), toMin(ms?.late_hours)),
      early_leave: makeItem(n(bz?.early_leave_min), toMin(ms?.early_leave_hours)),
    };

    let status: BizAuditStatus;
    const causes: string[] = [];
    if (bizHas && !mesHas) {
      status = "비즈만";
      causes.push(ms ? `MES 미입력/${ms.leave_type ?? "근무 없음"}, 비즈에 근무 있음` : "MES에 행 없음, 비즈에 근무 있음");
      bizOnlyRows++;
    } else if (!bizHas && mesHas) {
      status = "MES만";
      causes.push(bz ? "비즈 근무 없음(연차 등), MES에 근무 있음" : "비즈에 행 없음, MES에 근무 있음");
      mesOnlyRows++;
    } else {
      const bad = BIZ_AUDIT_ITEM_KEYS.filter((k) => items[k].mismatch);
      if (bad.length === 0) {
        status = "일치";
        matchRows++;
      } else {
        status = "불일치";
        mismatchRows++;
        for (const k of bad) byItem[k]++;
        if (bad.includes("normal")) {
          if (sup > 0) causes.push("지원시간 확인(정근)");
          else if (Math.abs(items.normal.diff) <= 20 && bad.length === 1) causes.push("정근 소폭 차이(10~20분)");
          else causes.push(items.normal.diff < 0 ? "정근: MES가 적음" : "정근: MES가 많음");
        }
        if (bad.includes("extension")) causes.push(items.extension.diff < 0 ? "연장: MES 미입력/부족" : "연장: 비즈가 적음");
        if (bad.includes("late")) causes.push("지각 차이");
        if (bad.includes("early_leave")) causes.push("조퇴 차이");
      }
    }
    for (const c of causes) causeCount.set(c, (causeCount.get(c) ?? 0) + 1);

    rows.push({
      employee_no: w.employee_no,
      biz_no: w.biz_employee_no,
      worker_name: w.worker_name,
      work_group: w.work_group,
      dept: bz?.dept ?? null,
      work_date: workDate,
      shift: bz?.shift ?? null,
      in_time: bz?.in_time ?? null,
      out_time: bz?.out_time ?? null,
      leave_type: ms?.leave_type ?? null,
      items,
      status,
      causes,
      note: bz?.note ?? null,
    });
  }

  rows.sort(
    (a, b) =>
      (a.work_group ?? "").localeCompare(b.work_group ?? "") ||
      a.employee_no.localeCompare(b.employee_no) ||
      a.work_date.localeCompare(b.work_date)
  );

  const compared = rows.length;
  return {
    dateFrom,
    dateTo,
    rows,
    summary: {
      comparedRows: compared,
      matchRows,
      mismatchRows,
      bizOnlyRows,
      mesOnlyRows,
      matchRate: compared > 0 ? matchRows / compared : null,
      byItem,
      byCause: [...causeCount.entries()].map(([cause, count]) => ({ cause, count })).sort((a, b) => b.count - a.count),
      excludedDates,
      unmatchedPersons: [...unmatched.values()].sort((a, b) => (a.dept ?? "").localeCompare(b.dept ?? "") || (a.name ?? "").localeCompare(b.name ?? "")),
      bizFrom: range.a,
      bizTo: range.b,
    },
  };
}
