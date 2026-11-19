import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { getDb } from "@/lib/db";
import { ensureMobileDefectTables, photoAbsPath } from "@/lib/mobile-defect";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; n: string }> };

// 모바일 불량입력 사진 보기(로그인 필요 — proxy.ts가 막는다)
export async function GET(_req: NextRequest, { params }: Params) {
  const { id, n } = await params;
  const col = { "1": "photo1", "2": "photo2", "3": "photo3" }[n];
  if (!col) return NextResponse.json({ error: "사진 번호가 잘못되었습니다." }, { status: 400 });
  const db = getDb();
  ensureMobileDefectTables(db);
  const row = db.prepare(`SELECT ${col} AS p FROM mobile_defect_entries WHERE id = ?`).get(Number(id)) as
    | { p: string | null }
    | undefined;
  const abs = row?.p ? photoAbsPath(row.p) : null;
  if (!abs || !fs.existsSync(abs)) return NextResponse.json({ error: "사진이 없습니다." }, { status: 404 });
  return new NextResponse(new Uint8Array(fs.readFileSync(abs)), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" },
  });
}
