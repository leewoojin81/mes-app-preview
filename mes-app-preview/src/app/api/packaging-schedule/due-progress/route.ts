import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { fetchDueProgress } from "@/lib/packaging-due-progress";

export const runtime = "nodejs";

// 계획정보(PLAN-03) 납기진행 — 진행 중인 수주의 납기일별 공정(중간창고·마킹·출하) 진행 현황
export async function GET() {
  return NextResponse.json(fetchDueProgress(getDb()));
}
