import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { numOrNull, strOrNull } from "@/lib/item-fields";
import { normalHoursFor } from "@/lib/work-hours-leave";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

const SUB_LABELS = ["정상", "잔업", "조출", "중교", "지각", "조퇴", "외출", "지원공정", "지원시간"];

// 지원시간은 실제로 다른 공정을 지원하며 일한 시간이라 합계에 더한다(2026-09-08 사용자
// 요청, api/work-hours/route.ts의 computeTotal과 동일한 공식). 지각/조퇴/외출은 합계에
// 반영하지 않고 기록용으로만 남긴다.
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

// 일일근태입력(PSN-01) 엑셀 업로드 — "일일근태입력.xlsx" 원본의 2행 병합헤더(1행=그룹명
// "자공정"/"지원공정", 2행=정상/잔업/조출/중교/지각/조퇴/외출/지원공정/지원시간)와, "엑셀
// 다운로드"가 내려주는 평평한 1행 헤더 둘 다 읽을 수 있다 — "사번"이 있는 행을 찾은 뒤
// 바로 다음 행에 SUB_LABELS(정상/잔업/...) 중 하나라도 있으면 병합헤더로 판단해 그 다음
// 행을 헤더로 합치고(다음 행 값이 있으면 우선, 없으면 위 행 값), 데이터는 그 두 줄 다음부터
// 시작한다. 없으면 평평한 헤더로 보고 바로 다음 행부터 데이터로 읽는다.
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const date = form?.get("date");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "업로드할 파일이 없습니다." }, { status: 400 });
  }
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(Buffer.from(await file.arrayBuffer()));
  } catch {
    return NextResponse.json(
      { error: "엑셀 파일을 읽을 수 없습니다. (.xlsx/.xls 파일인지 확인하세요)" },
      { status: 400 }
    );
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as (string | number | null)[][];

  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const h = (rows[i] ?? []).map((v) => (v == null ? "" : String(v).trim()));
    if (h.includes("사번")) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) {
    return NextResponse.json({ error: "1~10행에서 \"사번\" 컬럼을 찾을 수 없습니다." }, { status: 400 });
  }

  const row0 = (rows[headerRowIdx] ?? []).map((v) => (v == null ? "" : String(v).trim()));
  const row1 = (rows[headerRowIdx + 1] ?? []).map((v) => (v == null ? "" : String(v).trim()));
  const isMergedHeader = row1.some((v) => SUB_LABELS.includes(v));

  let header: string[];
  let dataStartIdx: number;
  if (isMergedHeader) {
    const width = Math.max(row0.length, row1.length);
    header = Array.from({ length: width }, (_, i) => row1[i] || row0[i] || "");
    dataStartIdx = headerRowIdx + 2;
  } else {
    header = row0;
    dataStartIdx = headerRowIdx + 1;
  }

  const iEmployeeNo = header.indexOf("사번");
  const iLeaveType = header.indexOf("휴가");
  const iOvertime = header.indexOf("잔업");
  const iEarlyStart = header.indexOf("조출");
  const iLunchShift = header.indexOf("중교");
  const iLate = header.indexOf("지각");
  const iEarlyLeave = header.indexOf("조퇴");
  const iOuting = header.indexOf("외출");
  const iSupportGroup = header.indexOf("지원공정");
  const iSupportHours = header.indexOf("지원시간");

  const db = getDb();
  const workers = db
    .prepare("SELECT employee_no, process_code FROM workers WHERE use_yn = 'Y' AND status = '정상'")
    .all() as {
    employee_no: string;
    process_code: string | null;
  }[];
  const workerByEmployeeNo = new Map(workers.map((w) => [w.employee_no, w]));

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
  const deleteSupport = db.prepare("DELETE FROM work_support_detail WHERE work_date = ? AND employee_no = ?");

  let updated = 0;
  let skippedNoKey = 0;

  db.exec("BEGIN");
  try {
    for (const r of rows.slice(dataStartIdx)) {
      const employeeNo = strOrNull(r[iEmployeeNo]);
      const worker = employeeNo ? workerByEmployeeNo.get(employeeNo) : undefined;
      if (!employeeNo || !worker) {
        skippedNoKey++;
        continue;
      }

      const leaveType = iLeaveType === -1 ? null : strOrNull(r[iLeaveType]);
      const overtimeHours = iOvertime === -1 ? 0 : numOrNull(r[iOvertime]) ?? 0;
      const earlyStartHours = iEarlyStart === -1 ? 0 : numOrNull(r[iEarlyStart]) ?? 0;
      const lunchShiftHours = iLunchShift === -1 ? 0 : numOrNull(r[iLunchShift]) ?? 0;
      const lateHours = iLate === -1 ? 0 : numOrNull(r[iLate]) ?? 0;
      const earlyLeaveHours = iEarlyLeave === -1 ? 0 : numOrNull(r[iEarlyLeave]) ?? 0;
      const outingHours = iOuting === -1 ? 0 : numOrNull(r[iOuting]) ?? 0;
      const supportWorkGroup = iSupportGroup === -1 ? null : strOrNull(r[iSupportGroup]);
      const supportHours = supportWorkGroup && iSupportHours !== -1 ? numOrNull(r[iSupportHours]) ?? 0 : 0;

      // 정상근무는 사람이 고칠 수 없다 — 업로드 파일의 "정상" 값이 있어도 무시하고
      // 휴가구분 기준시간(A안)에서 지각·조퇴·외출·지원시간을 뺀 값으로 저장한다.
      const normalHours = normalHoursFor(leaveType, {
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
        worker.process_code,
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
      updated++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ updated, skippedNoKey });
}
