import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";
import { fetchBizAll } from "@/lib/biz-attendance";
import { dateRange, MAX_LOOKUP_DAYS } from "@/lib/work-hours-lookup";
import { bizPersonsToBlocks, fillWeeklyTemplate, weeklyFilename } from "@/lib/weekly-attendance";

export const runtime = "nodejs";

// 비즈 탭 엑셀 다운로드(2026-10-14 사용자 요청) — "공정별 주간 근태" 서식(templates/weekly-attendance.xlsx)에
// 업로드해 둔 비즈 "기간별 근무관리" 값을 채워 내려준다(화면과 같은 조회기간·검색·부서 조건). 서식에 해당
// 부서 시트가 없는 인원(경영지원 등)은 빠지고 그 수만 X-Unassigned-Count 헤더로 알린다. 채우기 규칙은
// lib/weekly-attendance.ts의 bizPersonsToBlocks / fillWeeklyTemplate.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const dateFrom = params.get("dateFrom") ?? "";
  const dateTo = params.get("dateTo") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || dateFrom > dateTo) {
    return NextResponse.json({ error: "조회기간이 올바르지 않습니다." }, { status: 400 });
  }
  const dates = dateRange(dateFrom, dateTo);
  if (dates.length > MAX_LOOKUP_DAYS) {
    return NextResponse.json({ error: `조회기간은 최대 ${MAX_LOOKUP_DAYS}일까지 가능합니다.` }, { status: 400 });
  }
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  const leaderWorkGroups = session?.r === "leader" ? processCodesFromSession(session) : null;
  const persons = fetchBizAll(getDb(), {
    dateFrom,
    dateTo,
    q: params.get("q") ?? "",
    dept: params.get("dept") ?? "",
    leaderWorkGroups,
  });
  if (persons.length === 0) {
    return NextResponse.json({ error: "다운로드할 데이터가 없습니다." }, { status: 404 });
  }

  const now = new Date();
  const printedOn = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  let result;
  try {
    result = await fillWeeklyTemplate(bizPersonsToBlocks(persons), dates, printedOn);
  } catch (e) {
    return NextResponse.json(
      { error: `서식 파일을 처리하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 }
    );
  }

  const filename = weeklyFilename(dates);
  const headers: Record<string, string> = {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  };
  if (result.unassigned.length > 0) headers["X-Unassigned-Count"] = String(result.unassigned.length);
  return new NextResponse(new Uint8Array(result.buffer), { headers });
}
