import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";
import {
  dateRange,
  fetchGrandTotals,
  fetchWorkHoursLookup,
  MAX_LOOKUP_DAYS,
  PAGE_ROW_LIMIT,
  resolveEmployeeNos,
  type WorkHoursLookupPage,
} from "@/lib/work-hours-lookup";

export const runtime = "nodejs";

// 인원관리(PSN-05) "근무시간조회" — 공정(work_group) 또는 작업자 1명 + 조회기간을 받아
// PSN-01(일일근태입력)에 저장된 근태기록을 일자별로 내려준다(새로 입력/수정하지 않는 순수
// 조회 화면). workGroup을 주면 그 공정 소속 작업자 전원, employeeNo를 주면 그 1명만(조장
// 세션은 자기 소속공정 밖이면 결과에서 빠진다). export/route.ts가 같은 조건으로 엑셀도
// 내려준다.
//
// 2026-09-08: workGroup/employeeNo 둘 다 없어도 더 이상 막지 않는다 — resolveEmployeeNos가
// 조장 세션이면 자기 소속공정 전체로, 관리자 세션이면 전 인원("전체")으로 알아서 좁혀준다.
// 관리자가 "전체"로 조회해 대상이 많아지면(작업자 수 × 조회일수가 PAGE_ROW_LIMIT 초과)
// 에러로 막는 대신 인원 단위로 페이지를 나눈다(page 파라미터, 1부터 시작) — grandTotals는
// 현재 페이지가 아니라 조건에 맞는 전체 인원 기준으로 별도 집계해 페이지가 바뀌어도
// 같은 값을 보여준다.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const workGroup = params.get("workGroup") ?? "";
  const employeeNo = params.get("employeeNo") ?? "";
  const dateFrom = params.get("dateFrom");
  const dateTo = params.get("dateTo");
  const requestedPage = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
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

  const allEmployeeNos = resolveEmployeeNos(db, { workGroup, employeeNo, leaderWorkGroups });
  const totalWorkers = allEmployeeNos.length;
  const workersPerPage = Math.max(1, Math.floor(PAGE_ROW_LIMIT / days));
  const totalPages = totalWorkers === 0 ? 1 : Math.ceil(totalWorkers / workersPerPage);
  const page = Math.min(requestedPage, totalPages);
  const pageEmployeeNos = allEmployeeNos.slice((page - 1) * workersPerPage, page * workersPerPage);

  const pageResult = fetchWorkHoursLookup(db, { employeeNos: pageEmployeeNos, dateFrom, dateTo });
  const grandTotals = fetchGrandTotals(db, { employeeNos: allEmployeeNos, dateFrom, dateTo });

  const result: WorkHoursLookupPage = {
    ...pageResult,
    grandTotals,
    totalWorkers,
    page,
    pageSize: workersPerPage,
    totalPages,
  };
  return NextResponse.json(result);
}
