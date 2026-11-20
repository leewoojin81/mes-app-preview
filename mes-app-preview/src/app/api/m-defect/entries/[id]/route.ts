import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { ensureMobileDefectTables, unlinkMobileDefect } from "@/lib/mobile-defect";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// 모바일 불량입력 — 내가 오늘 입력한 건만 취소(행은 남기고 deleted_at 표시, 사진 파일도 그대로 둔다)
export async function DELETE(req: NextRequest, { params }: Params) {
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  ensureMobileDefectTables(db);
  const r = db
    .prepare(
      `UPDATE mobile_defect_entries SET deleted_at = datetime('now','localtime')
       WHERE id = ? AND username = ? AND deleted_at IS NULL AND date(created_at) = date('now','localtime')`
    )
    .run(Number(id), session.u);
  if (r.changes === 0) {
    return NextResponse.json({ error: "오늘 내가 입력한 건만 취소할 수 있습니다." }, { status: 404 });
  }
  // PROC-06-02에 붙어 있었으면 붙였던 내용 줄·사진을 뺀다
  try {
    unlinkMobileDefect(db, Number(id));
  } catch (e) {
    console.error("[모바일 불량입력] 연결 해제 실패", e);
  }
  return NextResponse.json({ ok: true });
}
