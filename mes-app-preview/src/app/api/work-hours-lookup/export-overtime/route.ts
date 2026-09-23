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
import { formatBizName } from "@/lib/biz-import";
import { FIXED_OVERTIME_APPLICATION_HOURS } from "@/lib/overtime-application";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

// 근무시간조회(PSN-05) "초과신청" 다운로드(2026-09-08 사용자 요청) — 실제 제출용 서식
// "실링 초과신청.xlsx"(사번/부서/성명/일자/조출/중교/잔업/비고 8컬럼, 작업자 1명당 조회
// 일자 하나씩 한 행)을 그대로 따른다. export/route.ts(근무시간조회 원본 서식)와 조회
// 조건은 완전히 같고 컬럼 구성만 다르다 — 정상/지각/조퇴/외출/지원은 이 서식에 없다
// (초과신청은 "그날 기본 근무를 넘겨 더 일한 시간"만 신청하는 서식이라 조출·중교·잔업만
// 담는다). 원본과 달리 성명은 매 행 채운다(원본은 사람이 나중에 손으로 채우는 빈칸이었지만,
// 여기선 이미 아는 값이라 바로 채워주는 게 더 쓸모 있다). 비고는 빈칸으로 남겨 신청자가
// 직접 채우게 한다.
//
// 2026-09-08: 사번/부서/성명은 우리 값이 아니라 "비즈" 원본값을 우선 내려준다(초과신청은
// 비즈 시스템에 그대로 제출하는 서식이라 우리 사번/공정 대신 비즈 표기가 맞음) —
// 사번=biz_employee_no, 부서=biz_dept, 성명=도급사 접두사를 되살린 비즈이름 표기
// (formatBizName). 비즈 연동 없이 등록된 작업자(biz_employee_no/biz_dept가 NULL)는
// 그 값이 없으니 우리 사번/공정으로 대체한다.
//
// 2026-09-20: 잔업 컬럼은 저장된 값 그대로가 아니라 고정 신청분(FIXED_OVERTIME_APPLICATION_HOURS,
// 2.34h = 2시간20분, PSN-06 근태대사와 동일 기준)을 초과한 분만 표기한다(사용자 요청, 예:
// 잔업 3.50 → 3.50-2.34=1.16). 2.34 이하(고정분을 다 못 채웠거나 딱 채운 경우)는 추가로
// 신청할 초과분이 없으므로 빈칸으로 둔다.
//
// 2026-09-24: onlyExcess=1이면 조출/중교/잔업(초과분) 중 하나도 없는 일자는 아예 행을
// 안 만든다(사용자 요청 — 화면의 "초과만 보기" 체크박스와 같은 조건이어야 화면에 보이는
// 값 그대로 다운로드된다).
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const workGroup = params.get("workGroup") ?? "";
  const employeeNo = params.get("employeeNo") ?? "";
  const dateFrom = params.get("dateFrom");
  const dateTo = params.get("dateTo");
  const onlyExcess = params.get("onlyExcess") === "1";
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

  const header = ["사번", "부서", "성명", "일자", "조출", "중교", "잔업", "비고"];
  const aoa: (string | number | null)[][] = [header];
  result.workers.forEach((w) => {
    const bizEmployeeNo = w.biz_employee_no || w.employee_no;
    const bizDept = w.biz_dept || w.work_group;
    const bizName = formatBizName(w.worker_name, w.contractor);
    w.rows.forEach((r) => {
      const overtimeExcess =
        r.overtime_hours > FIXED_OVERTIME_APPLICATION_HOURS
          ? Math.round((r.overtime_hours - FIXED_OVERTIME_APPLICATION_HOURS) * 100) / 100
          : 0;
      if (onlyExcess && r.early_start_hours <= 0 && r.lunch_shift_hours <= 0 && overtimeExcess <= 0) return;
      aoa.push([
        bizEmployeeNo,
        bizDept,
        bizName,
        r.work_date,
        r.early_start_hours || null,
        r.lunch_shift_hours || null,
        overtimeExcess || null,
        null,
      ]);
    });
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "초과신청");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const label = employeeNo || workGroup || "전체";
  const filename = `초과신청_${label}_${dateFrom}_${dateTo}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
