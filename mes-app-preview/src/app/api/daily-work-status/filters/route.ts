import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  DAILY_WORK_STATUS_DROPDOWN_FILTERS,
  DAILY_WORK_STATUS_JOIN,
  buildDailyWorkStatusWhere,
} from "@/lib/daily-work-status-filters";

export const runtime = "nodejs";

// 라인/설비/공정/품목계정/대분류/중분류/소분류 드롭다운 옵션.
// 각 필드의 옵션은 자기 자신을 제외한 나머지 필터를 적용한 상태에서 실제
// 존재하는 값만 반환한다(faceted) — 현재고현황(INV-02) 화면과 같은 방식.
export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const out: Record<string, string[]> = {};

  for (const f of DAILY_WORK_STATUS_DROPDOWN_FILTERS) {
    const { where, args } = buildDailyWorkStatusWhere(params, { skipParam: f.param });
    const cond = where
      ? `${where} AND ${f.expr} IS NOT NULL AND ${f.expr} != ''`
      : `WHERE ${f.expr} IS NOT NULL AND ${f.expr} != ''`;
    out[f.param] = (
      db
        .prepare(`SELECT DISTINCT ${f.expr} AS v ${DAILY_WORK_STATUS_JOIN} ${cond} ORDER BY v`)
        .all(...args) as { v: string }[]
    ).map((r) => r.v);
  }

  return NextResponse.json(out);
}
