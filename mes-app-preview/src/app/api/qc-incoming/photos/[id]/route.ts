import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureQcIncomingTables } from "@/lib/qc-incoming";

export const runtime = "nodejs";

// 사진 한 장 내려받기(이미지 본문) / 올린 사진 삭제(엑셀에서 들어온 사진은 삭제 불가)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return new NextResponse("bad request", { status: 400 });
  const db = getDb();
  ensureQcIncomingTables(db);
  const r = db.prepare("SELECT mime, data FROM qc_supply_photos WHERE id = ?").get(id) as { mime: string; data: Uint8Array } | undefined;
  if (!r?.data) return new NextResponse("not found", { status: 404 });
  return new NextResponse(new Uint8Array(r.data), {
    headers: { "Content-Type": r.mime, "Cache-Control": "private, max-age=86400" },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  const db = getDb();
  ensureQcIncomingTables(db);
  const r = db.prepare("DELETE FROM qc_supply_photos WHERE id = ? AND source = 'upload'").run(id);
  if (Number(r.changes) === 0) return NextResponse.json({ error: "올린 사진만 삭제할 수 있습니다." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
