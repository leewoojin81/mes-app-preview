import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";
import { resolveEmployeeNos } from "@/lib/work-hours-lookup";
import { fetchSpecialWorkGrid } from "@/lib/special-work-grid";

export const runtime = "nodejs";

const MAX_SPECIAL_GRID_DATES = 62;

// 근무시간조회(PSN-05) "특근일" 탭 그리드(2026-09-26 사용자 요청) — 화면에서 달력으로 고른
// 특근일(dates, 쉼표 구분)과 상단 필터(workGroup/employeeNo, 조장이면 세션으로 추가 스코프)로
// 작업자별 출근/퇴근/기본근무/연장근무를 내려준다. 계산 규칙은 lib/special-work-grid.ts.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const workGroup = params.get("workGroup") ?? "";
  const employeeNo = params.get("employeeNo") ?? "";
  const dates = (params.get("dates") ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (dates.length === 0) {
    return NextResponse.json({ error: "특근일을 하나 이상 선택해 주세요." }, { status: 400 });
  }
  if (dates.length > MAX_SPECIAL_GRID_DATES) {
    return NextResponse.json({ error: `특근일은 최대 ${MAX_SPECIAL_GRID_DATES}일까지 선택할 수 있습니다.` }, { status: 400 });
  }

  const db = getDb();
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  const leaderWorkGroups = session?.r === "leader" ? processCodesFromSession(session) : null;
  const employeeNos = resolveEmployeeNos(db, { workGroup, employeeNo, leaderWorkGroups });

  return NextResponse.json(fetchSpecialWorkGrid(db, { employeeNos, dates }));
}
