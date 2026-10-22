import { NextRequest, NextResponse } from "next/server";
import type { DatabaseSync } from "node:sqlite";
import { COOKIE_NAME, verifySession } from "@/lib/auth";

// 운영자 판정은 세션 쿠키(로그인 시점 스냅샷)가 아니라 매번 users 테이블에서 다시 읽는다 —
// SYS-01에서 운영자로 지정/해제하면 재로그인 없이 바로 반영되게.
export function isOperatorUser(db: DatabaseSync, username: string | null | undefined): boolean {
  if (!username) return false;
  const row = db.prepare("SELECT role FROM users WHERE username = ? AND use_yn = 'Y'").get(username) as
    | { role: string }
    | undefined;
  return row?.role === "operator";
}

export function hasActiveOperator(db: DatabaseSync): boolean {
  return !!db.prepare("SELECT 1 FROM users WHERE role = 'operator' AND use_yn = 'Y' LIMIT 1").get();
}

// 기준정보(BASE-01~09) 삭제는 운영자만(2026-10-22 사용자 요청) — DELETE 라우트 맨 앞에서 부른다.
// 생산캘린더(BASE-08)의 회사 등록 취소·공정 예외 초기화도 같은 날 운영자 전용으로 추가.
export function requireOperatorForDelete(
  req: NextRequest,
  db: DatabaseSync,
  message = "기준정보 삭제는 운영자만 할 수 있습니다."
): NextResponse | null {
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  if (isOperatorUser(db, session?.u)) return null;
  return NextResponse.json({ error: message }, { status: 403 });
}
