import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";

export const runtime = "nodejs";

// 근무시간조회(PSN-05) 화면의 "작업자 검색" 콤보박스용 — 사번/성명/공정만 가벼운 목록으로
// 내려준다. /api/workers(작업자등록 BASE-09 전용 API)를 그대로 쓰지 않는 이유: PSN-05만
// 개별 허용받고 BASE-09는 못 받은 사용자가 있을 수 있어(전화번호·입사일 등 더 민감한
// 필드까지 담긴 BASE-09 API를 열어줄 필요 없이) 이 화면 전용의 최소 필드 조회를 따로 둔다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);

  if (session?.r === "leader") {
    const leaderWorkGroups = processCodesFromSession(session);
    if (leaderWorkGroups.length === 0) return NextResponse.json([]);
    const placeholders = leaderWorkGroups.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT employee_no, worker_name, work_group FROM workers WHERE work_group IN (${placeholders}) ORDER BY seq, employee_no`
      )
      .all(...leaderWorkGroups);
    return NextResponse.json(rows);
  }

  const rows = db
    .prepare("SELECT employee_no, worker_name, work_group FROM workers ORDER BY seq, employee_no")
    .all();
  return NextResponse.json(rows);
}
