import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { invalidateRecommendCache } from "@/lib/packaging-recommend";
import { MoveError, movePackagingBlock } from "@/lib/packaging-move";

export const runtime = "nodejs";

// 계획정보(PLAN-03) 라인별 — 블록(칸 전체)을 같은 라인의 다른 날짜로 옮긴다(삽입 후 밀기). 이력은 packaging_move_history에 남는다.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { lineKey?: string; fromDate?: string; toDate?: string; mode?: string } | null;
  if (!body?.lineKey || !body.fromDate || !body.toDate) {
    return NextResponse.json({ error: "lineKey, fromDate, toDate가 필요합니다." }, { status: 400 });
  }
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  const db = getDb();
  try {
    const r = movePackagingBlock(db, {
      lineKey: body.lineKey,
      fromDate: body.fromDate,
      toDate: body.toDate,
      mode: body.mode ?? "push",
      user: session?.u ?? null,
    });
    invalidateRecommendCache(db);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof MoveError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
