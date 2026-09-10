import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";
import { fetchAttendanceAudit } from "@/lib/attendance-audit";

export const runtime = "nodejs";

// 근무시간조회(PSN-05)와 같은 상한 — 조회기간이 지나치게 넓어지는 것만 막는다.
const MAX_LOOKUP_DAYS = 366;

// 인원관리(PSN-06) "근태대사" — PSN-01(work_hours_daily)에 저장된 실제 근태 입력과
// PSN-02(attendance_card_status, 세콤 카드 원본)를 사번 변환+이름 교차검증으로 대조해
// 내려준다. 조장 세션은 자기 소속(work_group) 밖은 결과에서 빠진다(다른 PSN 화면과 동일).
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const dateFrom = params.get("dateFrom");
  const dateTo = params.get("dateTo");
  const workGroup = params.get("workGroup") ?? "";

  if (!dateFrom || !dateTo || !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    return NextResponse.json({ error: "dateFrom/dateTo는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  }
  if (dateFrom > dateTo) {
    return NextResponse.json({ error: "조회기간이 올바르지 않습니다(시작일 > 종료일)." }, { status: 400 });
  }
  const days =
    (new Date(`${dateTo}T00:00:00Z`).getTime() - new Date(`${dateFrom}T00:00:00Z`).getTime()) / 86400000 + 1;
  if (days > MAX_LOOKUP_DAYS) {
    return NextResponse.json({ error: `조회기간은 최대 ${MAX_LOOKUP_DAYS}일까지 가능합니다.` }, { status: 400 });
  }

  const db = getDb();
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  const leaderWorkGroups = session?.r === "leader" ? processCodesFromSession(session) : null;

  const result = fetchAttendanceAudit(db, { dateFrom, dateTo, workGroup, leaderWorkGroups });
  return NextResponse.json(result);
}
