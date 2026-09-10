import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { strOrNull } from "@/lib/item-fields";

export const runtime = "nodejs";

const DAY_TYPES = new Set(["평일", "휴일", "특근"]);

// 날짜 하나 등록/수정 (upsert)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "잘못된 날짜입니다." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const dayType = String(body.day_type ?? "");
  if (!DAY_TYPES.has(dayType)) {
    return NextResponse.json(
      { error: "근무구분은 평일/휴일/특근 중 하나여야 합니다." },
      { status: 400 }
    );
  }
  const workYn = body.work_yn === "N" ? "N" : "Y";
  const note = strOrNull(body.note);

  const db = getDb();
  db.prepare(
    `INSERT INTO production_calendar (cal_date, day_type, work_yn, note, updated_at)
     VALUES (?, ?, ?, ?, datetime('now','localtime'))
     ON CONFLICT(cal_date) DO UPDATE SET
       day_type=excluded.day_type, work_yn=excluded.work_yn, note=excluded.note,
       updated_at=datetime('now','localtime')`
  ).run(date, dayType, workYn, note);

  return NextResponse.json({ ok: true });
}

// 날짜 등록 취소 — 행을 지워 "미등록" 상태로 되돌린다.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params;
  const db = getDb();
  db.prepare("DELETE FROM production_calendar WHERE cal_date = ?").run(date);
  return NextResponse.json({ ok: true });
}
