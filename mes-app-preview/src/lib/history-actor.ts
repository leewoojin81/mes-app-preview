import type { NextRequest } from "next/server";
import type { DatabaseSync } from "node:sqlite";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { setHistoryActor } from "@/lib/master-history-triggers";

// 기준정보(BASE-01~09)를 바꾸는 API가 쓰기 직전에 부른다 — 로그인 계정을 변경이력 트리거에 알린다.
export function markHistoryActor(db: DatabaseSync, req: NextRequest, opts: { seconds?: number; skipTracked?: boolean } = {}): void {
  setHistoryActor(db, verifySession(req.cookies.get(COOKIE_NAME)?.value)?.u ?? null, opts);
}
