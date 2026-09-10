import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// 지급이력 삭제(잘못 등록한 건 정정용) — 이후 등록은 남은 이력의 최대 차수+1로 다시
// 매겨지므로(src/app/api/ppe-issuances POST) 중간 삭제로 차수가 충돌하지 않는다.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const result = db.prepare("DELETE FROM ppe_issuances WHERE id = ?").run(Number(id));
  if (result.changes === 0) {
    return NextResponse.json({ error: "지급이력을 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
