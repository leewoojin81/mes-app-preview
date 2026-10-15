import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { getBaseline, loadBaseline, snapshotSummary } from "@/lib/stock-ledger";

export const runtime = "nodejs";

// GET — 기초재고 적재 여부 + (미적재 시) 적재 대상 스냅샷 요약
export async function GET() {
  const db = getDb();
  const baseline = getBaseline(db);
  return NextResponse.json({ baseline, snapshot: baseline ? null : snapshotSummary(db) });
}

// POST { baseDate } — 현재고현황(INV-02) 스냅샷을 기초재고로 1회 적재
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const baseDate = String(body?.baseDate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate)) {
    return NextResponse.json({ error: "기준일을 입력하세요." }, { status: 400 });
  }
  const db = getDb();
  if (snapshotSummary(db).rows === 0) {
    return NextResponse.json({ error: "현재고현황(INV-02)에 업로드된 스냅샷이 없습니다." }, { status: 400 });
  }
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  const user = session?.n || session?.u || "unknown";
  const result = loadBaseline(db, baseDate, user);
  if (!result) {
    return NextResponse.json({ error: "기초재고가 이미 적재되어 있습니다." }, { status: 409 });
  }
  return NextResponse.json({ ok: true, ...result }, { status: 201 });
}
