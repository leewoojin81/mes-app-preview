import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";
import {
  dateRange,
  fetchWorkHoursLookup,
  MAX_LOOKUP_CELLS,
  MAX_LOOKUP_DAYS,
  resolveEmployeeNos,
} from "@/lib/work-hours-lookup";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

// 근무시간조회(PSN-05) 화면과 같은 조건(공정/작업자/조회기간)으로 "근무시간조회.xlsx"
// 원본과 같은 컬럼(No/사번/공정/성명/일자/정상/잔업/조출/중교/지각/조퇴/외출/지원)을
// 내려준다 — 원본처럼 사번/공정/성명은 각 작업자 블록의 첫 데이터행에만 채우고 나머지
// 행은 비워둔다. 화면에만 있는 소계/전체합계 요약행도 작업자 블록마다, 그리고 맨
// 마지막에 한 줄씩 덧붙인다.
//
// 2026-09-08: workGroup/employeeNo가 둘 다 없어도 막지 않는다(화면과 동일하게
// resolveEmployeeNos가 조장은 본인 소속공정 전체로, 관리자는 전 인원("전체")으로 좁혀
// 준다) — 화면에서 공정 선택을 강제하지 않게 바뀐 뒤에도 이 라우트만 예전 필수값 체크가
// 남아 있어 "전체" 조건으로는 엑셀 다운로드가 항상 400으로 실패하던 버그를 고쳤다.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const workGroup = params.get("workGroup") ?? "";
  const employeeNo = params.get("employeeNo") ?? "";
  const dateFrom = params.get("dateFrom");
  const dateTo = params.get("dateTo");
  if (!dateFrom || !dateTo || !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return NextResponse.json({ error: "dateFrom/dateTo는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  }
  if (dateFrom > dateTo) {
    return NextResponse.json({ error: "조회기간이 올바르지 않습니다(시작일 > 종료일)." }, { status: 400 });
  }
  const days = dateRange(dateFrom, dateTo).length;
  if (days > MAX_LOOKUP_DAYS) {
    return NextResponse.json(
      { error: `조회기간은 최대 ${MAX_LOOKUP_DAYS}일까지 가능합니다.` },
      { status: 400 }
    );
  }

  const db = getDb();
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  const leaderWorkGroups = session?.r === "leader" ? processCodesFromSession(session) : null;

  const employeeNos = resolveEmployeeNos(db, { workGroup, employeeNo, leaderWorkGroups });
  if (employeeNos.length * days > MAX_LOOKUP_CELLS) {
    return NextResponse.json(
      { error: "조회 대상이 너무 많습니다. 공정을 좁히거나 조회기간을 줄여 주세요." },
      { status: 400 }
    );
  }

  const result = fetchWorkHoursLookup(db, { employeeNos, dateFrom, dateTo });

  const header = ["No.", "사번", "공정", "성명", "일자", "정상", "잔업", "조출", "중교", "지각", "조퇴", "외출", "지원"];
  const aoa: (string | number | null)[][] = [header];
  result.workers.forEach((w, wIdx) => {
    w.rows.forEach((r, idx) => {
      aoa.push([
        idx === 0 ? wIdx + 1 : null,
        idx === 0 ? w.employee_no : null,
        idx === 0 ? w.work_group : null,
        idx === 0 ? w.worker_name : null,
        r.work_date,
        r.normal_hours || null,
        r.overtime_hours || null,
        r.early_start_hours || null,
        r.lunch_shift_hours || null,
        r.late_hours || null,
        r.early_leave_hours || null,
        r.outing_hours || null,
        r.support_hours || null,
      ]);
    });
    aoa.push([
      null,
      null,
      null,
      `${w.worker_name} 소계`,
      "",
      w.totals.normal_hours,
      w.totals.overtime_hours,
      w.totals.early_start_hours,
      w.totals.lunch_shift_hours,
      w.totals.late_hours,
      w.totals.early_leave_hours,
      w.totals.outing_hours,
      w.totals.support_hours,
    ]);
  });
  if (result.workers.length > 1) {
    aoa.push([
      null,
      null,
      null,
      "전체합계",
      "",
      result.grandTotals.normal_hours,
      result.grandTotals.overtime_hours,
      result.grandTotals.early_start_hours,
      result.grandTotals.lunch_shift_hours,
      result.grandTotals.late_hours,
      result.grandTotals.early_leave_hours,
      result.grandTotals.outing_hours,
      result.grandTotals.support_hours,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "근무시간조회");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const label = employeeNo || workGroup || "전체";
  const filename = `근무시간조회_${label}_${dateFrom}_${dateTo}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
