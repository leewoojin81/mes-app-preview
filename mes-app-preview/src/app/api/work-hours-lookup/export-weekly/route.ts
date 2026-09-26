import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";
import { dateRange, MAX_LOOKUP_CELLS, MAX_LOOKUP_DAYS, resolveEmployeeNos } from "@/lib/work-hours-lookup";
import { buildWeeklyBlocks, fillWeeklyTemplate, weeklyFilename } from "@/lib/weekly-attendance";

export const runtime = "nodejs";

// 근무시간조회(PSN-05) "주간근태" 다운로드(2026-09-26 사용자 요청) — 실제 제출용 서식
// "공정별 주간 근태_26.09.01~09.06.xlsx"에 PSN-01/PSN-02 데이터를 채워 내려준다.
// 화면의 조회기간(dateFrom~dateTo)을 그대로 쓴다(예: 9/7~9/13이면 그 기간만). 공정/작업자 필터는 받지 않는다 — 서식
// 자체가 공정별 시트 묶음이라 전체를 한 파일로 만든다(조장은 resolveEmployeeNos가 본인
// 소속공정으로 좁혀주므로 자기 공정 시트만 채워진다). 규칙 상세는 lib/weekly-attendance.ts.
export async function GET(req: NextRequest) {
  const dateFrom = req.nextUrl.searchParams.get("dateFrom");
  const dateTo = req.nextUrl.searchParams.get("dateTo");
  const valid = (d: string | null): d is string =>
    !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
  if (!valid(dateFrom) || !valid(dateTo)) {
    return NextResponse.json({ error: "dateFrom/dateTo는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  }
  if (dateFrom > dateTo) {
    return NextResponse.json({ error: "조회기간이 올바르지 않습니다(시작일 > 종료일)." }, { status: 400 });
  }
  const dates = dateRange(dateFrom, dateTo);
  if (dates.length > MAX_LOOKUP_DAYS) {
    return NextResponse.json({ error: `조회기간은 최대 ${MAX_LOOKUP_DAYS}일까지 가능합니다.` }, { status: 400 });
  }

  const db = getDb();
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  const leaderWorkGroups = session?.r === "leader" ? processCodesFromSession(session) : null;
  const employeeNos = resolveEmployeeNos(db, { workGroup: "", employeeNo: "", leaderWorkGroups });

  if (employeeNos.length * dates.length > MAX_LOOKUP_CELLS) {
    return NextResponse.json(
      { error: "조회 대상이 너무 많습니다. 조회기간을 줄여 주세요." },
      { status: 400 }
    );
  }

  const blocks = buildWeeklyBlocks(db, employeeNos, dates);
  const now = new Date();
  const printedOn = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  let result;
  try {
    result = await fillWeeklyTemplate(blocks, dates, printedOn);
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
  // 서식에 해당 부서 시트가 없어 빠진 작업자가 있으면 수만 알린다(파일 자체는 정상).
  if (result.unassigned.length > 0) headers["X-Unassigned-Count"] = String(result.unassigned.length);
  return new NextResponse(new Uint8Array(result.buffer), { headers });
}
