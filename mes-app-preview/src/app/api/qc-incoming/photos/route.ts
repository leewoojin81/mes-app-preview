import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { ensureQcIncomingTables, listPhotos } from "@/lib/qc-incoming";

export const runtime = "nodejs";

const MAX_BYTES = 6 * 1024 * 1024;

// 부자재 로트 사진 — 목록(?no=로트번호)과 올리기. 이미지는 화면에서 긴 변 1600px JPEG로 줄여 보낸다(대시보드와 같음).
export async function GET(req: NextRequest) {
  const no = Number(req.nextUrl.searchParams.get("no"));
  if (!Number.isInteger(no) || no < 0) return NextResponse.json({ error: "no가 필요합니다." }, { status: 400 });
  return NextResponse.json({ photos: listPhotos(getDb(), no) });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { no?: number; note?: string; image?: string; w?: number; h?: number } | null;
  const no = Math.round(Number(body?.no ?? 0));
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([\s\S]+)$/.exec(body?.image ?? "");
  if (!body || !m || !Number.isInteger(no) || no < 0) return NextResponse.json({ error: "사진 형식이 올바르지 않습니다." }, { status: 400 });
  const buf = Buffer.from(m[2], "base64");
  if (buf.length === 0 || buf.length > MAX_BYTES) return NextResponse.json({ error: "사진 용량이 너무 큽니다(6MB 이하)." }, { status: 413 });
  const db = getDb();
  ensureQcIncomingTables(db);
  if (no > 0 && !db.prepare("SELECT 1 FROM qc_supply_lots WHERE no = ?").get(no)) {
    return NextResponse.json({ error: "로트를 찾을 수 없습니다." }, { status: 404 });
  }
  const user = verifySession(req.cookies.get(COOKIE_NAME)?.value)?.u ?? null;
  const r = db
    .prepare("INSERT INTO qc_supply_photos (lot_no, source, caption, note, ts, mime, data, w, h, created_by) VALUES (?, 'upload', '', ?, ?, ?, ?, ?, ?, ?)")
    .run(no, String(body.note ?? "").trim().slice(0, 200), new Date().toISOString(), m[1], buf, Math.round(Number(body.w)) || null, Math.round(Number(body.h)) || null, user);
  return NextResponse.json({ ok: true, id: Number(r.lastInsertRowid) }, { status: 201 });
}
