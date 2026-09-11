import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as XLSX from "xlsx";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";
import { defaultLeaveTypeForCalendar, computeAttendanceHours } from "@/lib/work-hours-leave";

export const runtime = "nodejs";

// 일일근태입력(PSN-01) 특정 날짜를 "일일근태입력.xlsx" 원본과 같은 컬럼 순서로 내려준다
// (병합헤더 없이 평평한 1행 헤더 — 왕복 업로드 파싱을 단순하게 유지하기 위해 화면의
// 그룹헤더는 재현하지 않음, 컬럼 이름/순서는 동일).
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  }
  const db = getDb();
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);

  let workers: {
    employee_no: string;
    worker_name: string;
    work_group: string | null;
    duty: string | null;
    team: string | null;
  }[];
  if (session?.r === "leader") {
    const leaderWorkGroups = processCodesFromSession(session);
    if (leaderWorkGroups.length === 0) {
      workers = [];
    } else {
      const placeholders = leaderWorkGroups.map(() => "?").join(",");
      workers = db
        .prepare(
          `SELECT employee_no, worker_name, work_group, duty, team FROM workers
           WHERE use_yn = 'Y' AND status = '정상' AND work_group IN (${placeholders}) ORDER BY seq, employee_no`
        )
        .all(...leaderWorkGroups) as typeof workers;
    }
  } else {
    workers = db
      .prepare(
        "SELECT employee_no, worker_name, work_group, duty, team FROM workers WHERE use_yn = 'Y' AND status = '정상' ORDER BY seq, employee_no"
      )
      .all() as typeof workers;
  }

  const dailyRows = db
    .prepare(
      `SELECT employee_no, leave_type, normal_hours, overtime_hours, early_start_hours, lunch_shift_hours,
              late_hours, early_leave_hours, outing_hours
       FROM work_hours_daily WHERE work_date = ?`
    )
    .all(date) as {
    employee_no: string;
    leave_type: string | null;
    normal_hours: number;
    overtime_hours: number;
    early_start_hours: number;
    lunch_shift_hours: number;
    late_hours: number;
    early_leave_hours: number;
    outing_hours: number;
  }[];
  const dailyByEmployee = new Map(dailyRows.map((r) => [r.employee_no, r]));

  const supportRows = db
    .prepare("SELECT employee_no, support_work_group, support_hours FROM work_support_detail WHERE work_date = ?")
    .all(date) as { employee_no: string; support_work_group: string; support_hours: number }[];
  const supportByEmployee = new Map(supportRows.map((r) => [r.employee_no, r]));

  // 그리드화면(route.ts GET)과 동일하게, 아직 저장 안 된 행은 생산캘린더(BASE-08)의 그날
  // 구분(휴일→휴무, 그 외→출근)을 휴가구분 기본값으로 쓴다.
  const calendarRow = db
    .prepare("SELECT day_type FROM production_calendar WHERE cal_date = ?")
    .get(date) as { day_type: string } | undefined;
  const defaultLeaveType = defaultLeaveTypeForCalendar(calendarRow?.day_type);

  const data = workers.map((w, idx) => {
    const d = dailyByEmployee.get(w.employee_no);
    const support = supportByEmployee.get(w.employee_no);
    const overtime = d?.overtime_hours ?? 0;
    const earlyStart = d?.early_start_hours ?? 0;
    const lunchShift = d?.lunch_shift_hours ?? 0;
    const late = d?.late_hours ?? 0;
    const earlyLeave = d?.early_leave_hours ?? 0;
    const outing = d?.outing_hours ?? 0;
    const supportHours = support?.support_hours ?? 0;
    const leaveType = d ? d.leave_type : defaultLeaveType;
    // 정상/잔업 둘 다 사람이 고칠 수 없다 — 저장분이 있어도 무시하고 새 계산 순서
    // (work-hours-leave.ts의 computeAttendanceHours)로 다시 구해 내려준다.
    const { normalHours: normal, overtimeHours: overtimeFinal } = computeAttendanceHours(leaveType, {
      overtimeInput: overtime,
      lateHours: late,
      earlyLeaveHours: earlyLeave,
      outingHours: outing,
      supportHours,
    });
    // 지원시간은 다른 공정을 지원하며 일한 시간이라 합계에 더한다(2026-09-08 사용자 요청,
    // api/work-hours/route.ts의 computeTotal과 동일한 공식). 지각/조퇴/외출은 합계에
    // 반영하지 않는다.
    const total = normal + overtimeFinal + earlyStart + lunchShift + supportHours;
    return {
      No: idx + 1,
      사번: w.employee_no,
      공정: w.work_group,
      직무: w.duty,
      성명: w.worker_name,
      근무조: w.team,
      근무시간: total,
      휴가: leaveType,
      정상: normal,
      잔업: overtimeFinal,
      조출: earlyStart,
      중교: lunchShift,
      지각: late,
      조퇴: earlyLeave,
      외출: outing,
      지원공정: support?.support_work_group ?? null,
      지원시간: supportHours,
    };
  });

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "일일근태입력");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const filename = `일일근태입력_${date}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
