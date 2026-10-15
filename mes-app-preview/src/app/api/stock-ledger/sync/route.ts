import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getBaseline, syncLedger } from "@/lib/stock-ledger";

export const runtime = "nodejs";

// POST { dryRun?: boolean } — 기초재고 기준일 이후의 구매입고/MOLD입고/창고이동/출하 업로드 데이터를
// 수불 원장에 반영한다. 이미 반영된 원본 행은 건너뛰므로 여러 번 눌러도 중복되지 않는다.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const db = getDb();
  const baseline = getBaseline(db);
  if (!baseline) {
    return NextResponse.json({ error: "기초재고를 먼저 적재하세요." }, { status: 400 });
  }
  const results = syncLedger(db, baseline.base_date, body?.dryRun === true);
  return NextResponse.json({ baseDate: baseline.base_date, dryRun: body?.dryRun === true, results });
}
