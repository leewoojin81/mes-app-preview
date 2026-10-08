import type { DatabaseSync } from "node:sqlite";
import { formatBizName } from "@/lib/biz-import";

// PSN-05 "특근일" 탭 그리드(2026-09-26 사용자 요청) — 양식 "2026년 09월 일요일근무.xlsx"
// ("■ 주말근무자 세부 List")처럼 작업자 1명당 4행(출근시간/퇴근시간/기본근무 계/연장근무 계)을
// 쓰고 선택한 특근일을 가로 열로 펼친다. 값의 출처:
//  - 기본/연장: PSN-01 기준(2026-10-06 사용자 요청) — 기본=그날 정상근무(work_hours_daily.normal_hours),
//    연장=총근무시간(total_hours)에서 기본을 뺀 나머지(잔업·조출·중교·지원). 특근일 다운로드(export-special)도
//    이 함수를 쓰므로 두 결과가 일치한다
//  - 출근/퇴근시각: PSN-02 카드(attendance_card_status). 카드 사원번호는 비즈 사번이라
//    workers.biz_employee_no로 잇는다(없으면 우리 사번). 카드가 없으면 빈칸
//  - 야간 근무일 수(night_days): 카드 출근시각이 20:00 이후인 날의 수. 다운로드의 야간식대는
//    패널에 입력한 야간식대 금액(1회당) × 이 일수로 계산한다(2026-09-26 사용자 요청)
// 선택한 날짜 중 총근무시간이 있는 날이 하나도 없는 작업자는 목록에서 뺀다.

export const NIGHT_MEAL_FROM = "20:00";

export interface SpecialGridCell {
  in_time: string;
  out_time: string;
  base: number;
  overtime: number;
  /** PSN-01 그날 조출/잔업/중교/지각/조퇴/외출 — 급여 확인용 표시(2026-09-28 사용자 요청).
   *  기본/연장(총근무시간 기준)과 별개로 저장된 값을 그대로 보여준다. */
  early_start: number;
  work_overtime: number;
  lunch_shift: number;
  late: number;
  early_leave: number;
  outing: number;
}
export interface SpecialGridWorker {
  employee_no: string;
  process: string;
  name: string;
  cells: Record<string, SpecialGridCell>;
  base_total: number;
  overtime_total: number;
  /** 카드 출근시각이 20:00 이후인 날 수 — 야간식대(1회당 금액 × 일수) 계산용 */
  night_days: number;
}
export interface SpecialGridResult {
  dates: string[];
  workers: SpecialGridWorker[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function fetchSpecialWorkGrid(
  db: DatabaseSync,
  params: { employeeNos: string[]; dates: string[] }
): SpecialGridResult {
  const dates = [...new Set(params.dates)].sort();
  if (params.employeeNos.length === 0 || dates.length === 0) return { dates, workers: [] };

  const empPh = params.employeeNos.map(() => "?").join(",");
  const datePh = dates.map(() => "?").join(",");

  const workerRows = db
    .prepare(
      `SELECT employee_no, biz_employee_no, worker_name, contractor, work_group, biz_dept
       FROM workers WHERE employee_no IN (${empPh}) ORDER BY seq, employee_no`
    )
    .all(...params.employeeNos) as unknown as {
    employee_no: string;
    biz_employee_no: string | null;
    worker_name: string;
    contractor: string | null;
    work_group: string | null;
    biz_dept: string | null;
  }[];

  const dailyRows = db
    .prepare(
      `SELECT employee_no, work_date, total_hours, normal_hours, early_start_hours, overtime_hours, lunch_shift_hours,
              late_hours, early_leave_hours, outing_hours
       FROM work_hours_daily
       WHERE employee_no IN (${empPh}) AND work_date IN (${datePh})`
    )
    .all(...params.employeeNos, ...dates) as unknown as {
    employee_no: string;
    work_date: string;
    total_hours: number;
    normal_hours: number;
    early_start_hours: number;
    overtime_hours: number;
    lunch_shift_hours: number;
    late_hours: number;
    early_leave_hours: number;
    outing_hours: number;
  }[];
  const dailyByKey = new Map(dailyRows.map((r) => [`${r.employee_no}|${r.work_date}`, r]));

  const cardKeys = new Set<string>();
  for (const w of workerRows) {
    cardKeys.add(w.biz_employee_no ?? w.employee_no);
    cardKeys.add(w.employee_no);
  }
  const cardRows = db
    .prepare(`SELECT employee_no, work_date, detail FROM attendance_card_status WHERE work_date IN (${datePh})`)
    .all(...dates) as unknown as { employee_no: string | null; work_date: string | null; detail: string | null }[];
  const cardByKey = new Map<string, { in_time: string; out_time: string }>();
  for (const r of cardRows) {
    if (!r.employee_no || !r.work_date || !r.detail || !cardKeys.has(r.employee_no)) continue;
    try {
      const d = JSON.parse(r.detail) as Record<string, string | number | null>;
      cardByKey.set(`${r.employee_no}|${r.work_date}`, {
        in_time: String(d["출근시간"] ?? "").slice(0, 5),
        out_time: String(d["퇴근시간"] ?? "").slice(0, 5),
      });
    } catch {
      /* 깨진 detail은 무시 */
    }
  }

  const workers: SpecialGridWorker[] = [];
  for (const w of workerRows) {
    const bizNo = w.biz_employee_no ?? w.employee_no;
    const cells: Record<string, SpecialGridCell> = {};
    let baseTotal = 0;
    let overtimeTotal = 0;
    let nightDays = 0;
    for (const date of dates) {
      const daily = dailyByKey.get(`${w.employee_no}|${date}`);
      const total = daily?.total_hours ?? 0;
      if (total <= 0) continue;
      const card = cardByKey.get(`${bizNo}|${date}`) ?? cardByKey.get(`${w.employee_no}|${date}`);
      const base = Math.min(daily?.normal_hours ?? 0, total);
      const overtime = Math.max(total - base, 0);
      cells[date] = {
        in_time: card?.in_time ?? "",
        out_time: card?.out_time ?? "",
        base: round2(base),
        overtime: round2(overtime),
        early_start: round2(daily?.early_start_hours ?? 0),
        work_overtime: round2(daily?.overtime_hours ?? 0),
        lunch_shift: round2(daily?.lunch_shift_hours ?? 0),
        late: round2(daily?.late_hours ?? 0),
        early_leave: round2(daily?.early_leave_hours ?? 0),
        outing: round2(daily?.outing_hours ?? 0),
      };
      baseTotal += base;
      overtimeTotal += overtime;
      if (cells[date].in_time && cells[date].in_time >= NIGHT_MEAL_FROM) nightDays++;
    }
    if (Object.keys(cells).length === 0) continue;
    workers.push({
      employee_no: w.employee_no,
      process: (w.biz_dept ?? w.work_group ?? "").trim(),
      name: formatBizName(w.worker_name, w.contractor),
      cells,
      base_total: round2(baseTotal),
      overtime_total: round2(overtimeTotal),
      night_days: nightDays,
    });
  }
  return { dates, workers };
}
