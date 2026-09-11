import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { numOrNull, strOrNull, strVal } from "@/lib/item-fields";
import { defaultLeaveTypeForCalendar, computeAttendanceHours } from "@/lib/work-hours-leave";
import type { WorkHoursRow } from "@/lib/types";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";
import { ENTITY_TYPE_WORKER, fetchFieldHistoryMap, resolveFieldAsOf } from "@/lib/master-data-history";

export const runtime = "nodejs";

interface WorkerRow {
  employee_no: string;
  erp_code: string | null;
  employee_qr: string | null;
  worker_name: string;
  contractor: string | null;
  work_group: string | null;
  team: string | null;
  shift_group: string | null;
  duty: string | null;
  process_code: string | null;
}

interface WorkHoursDailyRow {
  employee_no: string;
  leave_type: string | null;
  normal_hours: number;
  overtime_hours: number;
  early_start_hours: number;
  lunch_shift_hours: number;
  late_hours: number;
  early_leave_hours: number;
  outing_hours: number;
  total_hours: number;
}

interface SupportDetailRow {
  employee_no: string;
  support_work_group: string;
  support_hours: number;
}

// 지각/조퇴/외출은 합계에 반영하지 않고 기록용으로만 남긴다. 지원시간은 다른 공정을
// 지원하며 실제로 일한 시간이라 합계에 더한다(2026-09-08 사용자 요청).
function computeTotal(fields: {
  normal_hours: number;
  overtime_hours: number;
  early_start_hours: number;
  lunch_shift_hours: number;
  support_hours: number;
}): number {
  return (
    fields.normal_hours +
    fields.overtime_hours +
    fields.early_start_hours +
    fields.lunch_shift_hours +
    fields.support_hours
  );
}

// 인원관리(PSN-01) "일일근태입력" — 재직 중이고(use_yn='Y') 상태가 "정상"인 작업자만 기준으로
// 그 날짜의 work_hours_daily/work_support_detail 저장분을 덧씌워 내려준다(2026-09-07 사용자
// 요청 — 퇴사/육휴/출휴/병가 상태는 실제로 출근하지 않으니 근태입력 대상에서 제외). 저장분이
// 없으면 나머지=0을 기본값으로 채운다. 정상(normal_hours)은 사람이 고칠 수 없어 저장분이
// 있어도 항상 휴가구분 기준 계산값(A안, work-hours-leave.ts)으로 내려준다. 조장은 소속
// (work_group) 작업자만 내려받는다. 정렬은 1순위 공정코드(workers.process_code, BASE-04
// 세부공정코드 — work_group "공정" 표시와는 다른 필드) 오름차순, 2순위 입사일자 오름차순,
// 마지막에 사번으로 동률만 정리한다(2026-09-09 사용자 요청 — 기존 seq 기준을 대체).

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  }
  const db = getDb();
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);

  let workers: WorkerRow[];
  if (session?.r === "leader") {
    const leaderWorkGroups = processCodesFromSession(session);
    if (leaderWorkGroups.length === 0) {
      workers = [];
    } else {
      const placeholders = leaderWorkGroups.map(() => "?").join(",");
      workers = db
        .prepare(
          `SELECT employee_no, erp_code, employee_qr, worker_name, contractor, work_group, team, shift_group, duty, process_code
           FROM workers
           WHERE use_yn = 'Y' AND status = '정상' AND work_group IN (${placeholders})
           ORDER BY process_code, hire_date, employee_no`
        )
        .all(...leaderWorkGroups) as unknown as WorkerRow[];
    }
  } else {
    workers = db
      .prepare(
        `SELECT employee_no, erp_code, employee_qr, worker_name, contractor, work_group, team, shift_group, duty, process_code
         FROM workers WHERE use_yn = 'Y' AND status = '정상'
         ORDER BY process_code, hire_date, employee_no`
      )
      .all() as unknown as WorkerRow[];
  }

  // 근무조는 workers.team(현재값)을 그대로 내려주면 안 된다 — 근태대사(PSN-06)는 조회
  // 날짜 기준 이력(master_data_change_history)으로 "그 당시 값"을 재구성해서 보여주는데,
  // 여기서는 현재값을 그대로 보여주면 과거 날짜를 조회할 때 둘이 어긋난다(2026-09-11
  // 실사례 — 근태대사엔 2조로 남아있는 과거 날짜인데 여기선 항상 최신값인 1조로 보여서,
  // 그리드가 이미 "맞는 값"을 보여주는 줄 알고 저장을 안 누르게 됨). PSN-06과 동일하게
  // 이력 기준으로 재구성해 내려준다 — "선택 항목 일괄수정"/그리드에서 고친 값과 이
  // 값이 다를 때만 save()가 /api/workers/team으로 반영하므로, 기준값 자체가 어긋나 있으면
  // 그 비교도 같이 어긋난다.
  const employeeNos = workers.map((w) => w.employee_no);
  const teamHistory = fetchFieldHistoryMap(db, ENTITY_TYPE_WORKER, "team", employeeNos);

  const dailyRows = db
    .prepare(
      `SELECT employee_no, leave_type, normal_hours, overtime_hours, early_start_hours, lunch_shift_hours,
              late_hours, early_leave_hours, outing_hours, total_hours
       FROM work_hours_daily WHERE work_date = ?`
    )
    .all(date) as unknown as WorkHoursDailyRow[];
  const dailyByEmployee = new Map(dailyRows.map((r) => [r.employee_no, r]));

  const supportRows = db
    .prepare("SELECT employee_no, support_work_group, support_hours FROM work_support_detail WHERE work_date = ?")
    .all(date) as unknown as SupportDetailRow[];
  const supportByEmployee = new Map(supportRows.map((r) => [r.employee_no, r]));

  // 그리드화면 "휴가" 드롭다운 기본값(2026-09-08 사용자 요청) — 아직 저장 안 된 행만
  // 생산캘린더(BASE-08)의 그날 구분(휴일→휴무, 그 외→출근)을 기본값으로 채운다.
  const calendarRow = db
    .prepare("SELECT day_type FROM production_calendar WHERE cal_date = ?")
    .get(date) as { day_type: string } | undefined;
  const defaultLeaveType = defaultLeaveTypeForCalendar(calendarRow?.day_type);

  const rows: WorkHoursRow[] = workers.map((w) => {
    const d = dailyByEmployee.get(w.employee_no);
    const support = supportByEmployee.get(w.employee_no);
    // 직무가 "디자인"인 인원은 그날 저장분이 없으면 지원공정/지원시간을 "디자인"/8시간으로
    // 미리 채워 보여준다(2026-09-10 사용자 요청 — 항상 디자인팀을 지원하는 인원이라 매번
    // 손으로 입력하지 않도록). 이미 저장된 분이 있으면(그 값이 무엇이든) 그대로 존중한다.
    const isDesignDuty = w.duty === "디자인";
    const supportWorkGroup = support ? support.support_work_group : isDesignDuty ? "디자인" : null;
    const supportHours = support ? support.support_hours : isDesignDuty ? 8 : 0;
    const leaveType = d ? d.leave_type : defaultLeaveType;
    const lateHours = d ? d.late_hours : 0;
    const earlyLeaveHours = d ? d.early_leave_hours : 0;
    const outingHours = d ? d.outing_hours : 0;
    // 정상/잔업 둘 다 사람이 고칠 수 없다 — 저장분이 있어도 무시하고 휴가구분·지각·조퇴·
    // 외출·지원시간·잔업신청값(저장된 잔업)으로 다시 계산해 내려준다(2026-09-11 사용자
    // 요청으로 잔업도 정상과 같은 계산값이 됨).
    const { normalHours, overtimeHours } = computeAttendanceHours(leaveType, {
      overtimeInput: d ? d.overtime_hours : 0,
      lateHours,
      earlyLeaveHours,
      outingHours,
      supportHours,
    });
    return {
      employee_no: w.employee_no,
      erp_code: w.erp_code,
      employee_qr: w.employee_qr,
      worker_name: w.worker_name,
      contractor: w.contractor,
      work_group: w.work_group,
      team: resolveFieldAsOf(teamHistory, w.employee_no, date, w.team),
      shift_group: w.shift_group,
      duty: w.duty,
      leave_type: leaveType,
      has_record: d != null,
      normal_hours: normalHours,
      overtime_hours: overtimeHours,
      early_start_hours: d ? d.early_start_hours : 0,
      lunch_shift_hours: d ? d.lunch_shift_hours : 0,
      late_hours: lateHours,
      early_leave_hours: earlyLeaveHours,
      outing_hours: outingHours,
      total_hours: computeTotal({
        normal_hours: normalHours,
        overtime_hours: overtimeHours,
        early_start_hours: d ? d.early_start_hours : 0,
        lunch_shift_hours: d ? d.lunch_shift_hours : 0,
        support_hours: supportHours,
      }),
      support_work_group: supportWorkGroup,
      support_hours: supportHours,
    };
  });

  const lastSaved = db
    .prepare("SELECT MAX(updated_at) AS t FROM work_hours_daily WHERE work_date = ?")
    .get(date) as { t: string | null };

  return NextResponse.json({ date, rows, lastSavedAt: lastSaved.t });
}

// 그 날짜 전체 행을 한 번에 upsert한다. 근무시간(total_hours)은 클라이언트가 보낸 값을
// 신뢰하지 않고 서버가 7개 입력값+지원시간으로 다시 계산해서 저장한다(엑셀 수식과 동일).
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.date !== "string" || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const date = body.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  }

  const db = getDb();
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  let leaderEmployeeNos: Set<string> | null = null;
  if (session?.r === "leader") {
    const leaderWorkGroups = processCodesFromSession(session);
    if (leaderWorkGroups.length === 0) {
      leaderEmployeeNos = new Set();
    } else {
      const placeholders = leaderWorkGroups.map(() => "?").join(",");
      const rows = db
        .prepare(`SELECT employee_no FROM workers WHERE work_group IN (${placeholders})`)
        .all(...leaderWorkGroups) as { employee_no: string }[];
      leaderEmployeeNos = new Set(rows.map((r) => r.employee_no));
    }
  }

  const workerProcessCodes = new Map(
    (db.prepare("SELECT employee_no, process_code FROM workers").all() as {
      employee_no: string;
      process_code: string | null;
    }[]).map((w) => [w.employee_no, w.process_code])
  );

  const upsertDaily = db.prepare(
    `INSERT INTO work_hours_daily
       (work_date, employee_no, process_code, leave_type, normal_hours, overtime_hours, early_start_hours,
        lunch_shift_hours, late_hours, early_leave_hours, outing_hours, total_hours, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(work_date, employee_no) DO UPDATE SET
       process_code=excluded.process_code, leave_type=excluded.leave_type,
       normal_hours=excluded.normal_hours,
       overtime_hours=excluded.overtime_hours, early_start_hours=excluded.early_start_hours,
       lunch_shift_hours=excluded.lunch_shift_hours, late_hours=excluded.late_hours,
       early_leave_hours=excluded.early_leave_hours, outing_hours=excluded.outing_hours,
       total_hours=excluded.total_hours, updated_at=datetime('now','localtime')`
  );
  const upsertSupport = db.prepare(
    `INSERT INTO work_support_detail (work_date, employee_no, support_work_group, support_hours, updated_at)
     VALUES (?, ?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(work_date, employee_no) DO UPDATE SET
       support_work_group=excluded.support_work_group, support_hours=excluded.support_hours,
       updated_at=datetime('now','localtime')`
  );
  const deleteSupport = db.prepare(
    "DELETE FROM work_support_detail WHERE work_date = ? AND employee_no = ?"
  );

  let saved = 0;
  for (const r of body.rows as Record<string, unknown>[]) {
    const employeeNo = strVal(r.employee_no);
    if (!employeeNo) continue;
    if (leaderEmployeeNos && !leaderEmployeeNos.has(employeeNo)) continue;

    const leaveType = strOrNull(r.leave_type);
    const overtimeInput = numOrNull(r.overtime_hours) ?? 0;
    const earlyStartHours = numOrNull(r.early_start_hours) ?? 0;
    const lunchShiftHours = numOrNull(r.lunch_shift_hours) ?? 0;
    const lateHours = numOrNull(r.late_hours) ?? 0;
    const earlyLeaveHours = numOrNull(r.early_leave_hours) ?? 0;
    const outingHours = numOrNull(r.outing_hours) ?? 0;
    const supportWorkGroup = strOrNull(r.support_work_group);
    const supportHours = supportWorkGroup ? numOrNull(r.support_hours) ?? 0 : 0;
    // 정상/잔업 둘 다 사람이 고칠 수 없다 — 클라이언트가 뭘 보내든(잔업 신청값 포함) 무시
    // 하고 새 계산 순서(work-hours-leave.ts의 computeAttendanceHours)로 다시 구해 저장
    // 한다(2026-09-11 사용자 요청).
    const { normalHours, overtimeHours } = computeAttendanceHours(leaveType, {
      overtimeInput,
      lateHours,
      earlyLeaveHours,
      outingHours,
      supportHours,
    });

    const totalHours = computeTotal({
      normal_hours: normalHours,
      overtime_hours: overtimeHours,
      early_start_hours: earlyStartHours,
      lunch_shift_hours: lunchShiftHours,
      support_hours: supportHours,
    });

    upsertDaily.run(
      date,
      employeeNo,
      workerProcessCodes.get(employeeNo) ?? null,
      leaveType,
      normalHours,
      overtimeHours,
      earlyStartHours,
      lunchShiftHours,
      lateHours,
      earlyLeaveHours,
      outingHours,
      totalHours
    );

    if (supportWorkGroup) {
      upsertSupport.run(date, employeeNo, supportWorkGroup, supportHours);
    } else {
      deleteSupport.run(date, employeeNo);
    }
    saved++;
  }

  return NextResponse.json({ ok: true, count: saved });
}

// 관리상 삭제(2026-09-08 사용자 요청) — 선택한 사번들의 그 날짜 저장 기록(work_hours_daily
// + work_support_detail)을 통째로 지운다. 값을 0으로 되돌리는 것과 달리 "저장상태"가
// 미저장으로 돌아가고, 다음 조회부터 그날 기본값(평일 8·토일/공휴일 0)이 다시 채워진다.
// 조장은 PUT과 동일하게 자기 소속(work_group) 밖 사번은 조용히 건너뛴다.
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.date !== "string" || !Array.isArray(body.employeeNos)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const date = body.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  }
  const employeeNos = (body.employeeNos as unknown[]).filter(
    (v): v is string => typeof v === "string" && v.trim() !== ""
  );
  if (employeeNos.length === 0) {
    return NextResponse.json({ error: "삭제할 사번이 없습니다." }, { status: 400 });
  }

  const db = getDb();
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  let targets = employeeNos;
  if (session?.r === "leader") {
    const leaderWorkGroups = processCodesFromSession(session);
    if (leaderWorkGroups.length === 0) {
      targets = [];
    } else {
      const placeholders = leaderWorkGroups.map(() => "?").join(",");
      const allowed = new Set(
        (
          db
            .prepare(`SELECT employee_no FROM workers WHERE work_group IN (${placeholders})`)
            .all(...leaderWorkGroups) as { employee_no: string }[]
        ).map((r) => r.employee_no)
      );
      targets = employeeNos.filter((no) => allowed.has(no));
    }
  }
  if (targets.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  const placeholders = targets.map(() => "?").join(",");
  const deleteDaily = db.prepare(
    `DELETE FROM work_hours_daily WHERE work_date = ? AND employee_no IN (${placeholders})`
  );
  const deleteSupport = db.prepare(
    `DELETE FROM work_support_detail WHERE work_date = ? AND employee_no IN (${placeholders})`
  );

  db.exec("BEGIN");
  try {
    const result = deleteDaily.run(date, ...targets);
    deleteSupport.run(date, ...targets);
    db.exec("COMMIT");
    return NextResponse.json({ ok: true, count: result.changes });
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
