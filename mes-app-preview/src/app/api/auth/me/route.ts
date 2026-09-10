import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { getAllowedCodesForUser } from "@/lib/permissions";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// Sidebar/각 화면이 로그인한 사용자의 role/소속공정을 알아야 메뉴 필터링·데이터 스코핑을
// 할 수 있어서 만든 조회용 엔드포인트 — proxy.ts가 이미 인증을 강제하므로 여기선 세션이
// 없을 때 401만 돌려주면 된다(직접 API 우회 방지용 재검증이기도 함).
// allowedCodes는 session.ac(로그인 시점 스냅샷)가 아니라 매 요청 DB에서 새로 계산한다 —
// 안 그러면 로그인 이후 추가된 화면/변경된 권한이 재로그인 전까진 사이드바에 반영이 안 된다.
export async function GET(req: NextRequest) {
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  const allowedCodes = getAllowedCodesForUser(getDb(), session.u, session.r);
  return NextResponse.json({
    username: session.u,
    role: session.r,
    processCodes: session.p ? session.p.split(",") : [],
    displayName: session.n,
    allowedCodes: Array.from(allowedCodes),
  });
}
