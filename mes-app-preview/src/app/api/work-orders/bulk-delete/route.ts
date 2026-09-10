import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const woNos = (body as { wo_nos?: string[] } | null)?.wo_nos;
  if (!Array.isArray(woNos) || woNos.length === 0) {
    return NextResponse.json({ error: "삭제할 작업지시가 없습니다." }, { status: 400 });
  }

  const db = getDb();
  const placeholders = woNos.map(() => "?").join(",");
  const result = db
    .prepare(`DELETE FROM work_orders WHERE wo_no IN (${placeholders})`)
    .run(...woNos);

  return NextResponse.json({ deleted: result.changes });
}
