import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { lookupOrderInfo } from "@/lib/packaging-schedule";

export const runtime = "nodejs";

// 수주번호로 수주현황에서 고객사·품명·개입수·납기일을 찾아온다(PLAN-03에서 수주번호를 입력하면 자동 채움).
export async function GET(req: NextRequest) {
  const soNo = req.nextUrl.searchParams.get("soNo") ?? "";
  if (!soNo.trim()) {
    return NextResponse.json({ error: "soNo가 필요합니다." }, { status: 400 });
  }
  const info = lookupOrderInfo(getDb(), soNo);
  if (!info) return NextResponse.json({ error: "수주현황에서 찾을 수 없는 수주번호입니다." }, { status: 404 });
  return NextResponse.json(info);
}
