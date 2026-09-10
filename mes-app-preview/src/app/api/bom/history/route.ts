import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { BomModelLog } from "@/lib/types";

export const runtime = "nodejs";

// BOM관리(BASE-03) "신규 모델 추가" 이력 목록 — 최신순, 기본 20건.
export async function GET(req: NextRequest) {
  const db = getDb();
  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10) || 20)
  );
  const rows = db
    .prepare("SELECT * FROM bom_model_log ORDER BY id DESC LIMIT ?")
    .all(limit) as unknown as BomModelLog[];
  return NextResponse.json(rows);
}
