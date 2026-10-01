import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";
import { fetchBizAudit } from "@/lib/biz-audit";
import { dateRange, MAX_LOOKUP_DAYS } from "@/lib/work-hours-lookup";

export const runtime = "nodejs";

// 인원관리(PSN-06) "비즈 대사" — PSN-05 비즈 탭에 올려 둔 비즈 근무관리 데이터와 PSN-01 저장값을
// 사번+일자로 대조한 결과를 내려준다(조회 전용). 조장 세션은 자기 소속공정 인원만 보인다.
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
  const result = fetchBizAudit(getDb(), {
    dateFrom,
    dateTo,
    workGroup: params.get("workGroup") ?? "",
    q: params.get("q") ?? "",
    leaderWorkGroups,
  });
  return NextResponse.json(result);
}
