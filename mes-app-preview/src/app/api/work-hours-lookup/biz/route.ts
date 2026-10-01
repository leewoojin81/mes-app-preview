import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";
import { fetchBizPage } from "@/lib/biz-attendance";
import { dateRange, MAX_LOOKUP_DAYS } from "@/lib/work-hours-lookup";

export const runtime = "nodejs";

// 인원관리(PSN-05) "비즈" 탭 — 업로드해 둔 비즈 "기간별 근무관리" 데이터를 조회기간·부서·사번/성명
// 조건으로 내려준다(조회 전용). 조장 세션은 자기 소속공정 작업자(비즈 사번으로 매칭)만 보인다.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const dateFrom = params.get("dateFrom");
  const dateTo = params.get("dateTo");
  if (!dateFrom || !dateTo || !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return NextResponse.json({ error: "dateFrom/dateTo는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  }
  if (dateFrom > dateTo) {
    return NextResponse.json({ error: "조회기간이 올바르지 않습니다(시작일 > 종료일)." }, { status: 400 });
  }
  if (dateRange(dateFrom, dateTo).length > MAX_LOOKUP_DAYS) {
    return NextResponse.json({ error: `조회기간은 최대 ${MAX_LOOKUP_DAYS}일까지 가능합니다.` }, { status: 400 });
  }
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  const leaderWorkGroups = session?.r === "leader" ? processCodesFromSession(session) : null;
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const result = fetchBizPage(
    getDb(),
    { dateFrom, dateTo, q: params.get("q") ?? "", dept: params.get("dept") ?? "", leaderWorkGroups },
    page
  );
  return NextResponse.json(result);
}
