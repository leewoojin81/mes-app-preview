import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listDefectTypes } from "@/lib/mobile-defect";

export const runtime = "nodejs";

// 모바일 불량입력(/m/defect) — 불량유형 마스터(공통 + 해당 공정 전용)
export async function GET(req: NextRequest) {
  const process = req.nextUrl.searchParams.get("process");
  return NextResponse.json({ types: listDefectTypes(getDb(), process) });
}
