import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// 보호구품목 마스터 조회 전용 — 고정 3종(src/lib/db.ts에서 시드)이라 화면에서
// 추가/수정하는 기능은 아직 없다.
export async function GET() {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM ppe_items WHERE use_yn = 'Y' ORDER BY seq")
    .all();
  return NextResponse.json(rows);
}
