import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { cachedQuery } from "@/lib/query-cache";
import {
  DAILY_WORK_STATUS_DROPDOWN_FILTERS,
  DAILY_WORK_STATUS_JOIN,
  buildDailyWorkStatusWhere,
} from "@/lib/daily-work-status-filters";

export const runtime = "nodejs";

// 라인/설비/공정/품목계정/대분류/중분류/소분류 드롭다운 옵션.
// 각 필드의 옵션은 자기 자신을 제외한 나머지 필터를 적용한 상태에서 실제
// 존재하는 값만 반환한다(faceted) — 현재고현황(INV-02) 화면과 같은 방식.
// 필터마다 전체 스캔이 필요해 무거우므로, 같은 필터·같은 데이터(마지막 업로드 시각)면
// 캐시를 재사용한다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const version =
    (
      db.prepare("SELECT MAX(uploaded_at) as t FROM daily_work_status").get() as {
        t: string | null;
      }
    ).t ?? "";

  const out = cachedQuery("dws-filters", version, params.toString(), () => {
    const result: Record<string, string[]> = {};
    for (const f of DAILY_WORK_STATUS_DROPDOWN_FILTERS) {
      const { where, args } = buildDailyWorkStatusWhere(params, { skipParam: f.param });
      const cond = where
        ? `${where} AND ${f.expr} IS NOT NULL AND ${f.expr} != ''`
        : `WHERE ${f.expr} IS NOT NULL AND ${f.expr} != ''`;
      result[f.param] = (
        db
          .prepare(`SELECT DISTINCT ${f.expr} AS v ${DAILY_WORK_STATUS_JOIN} ${cond} ORDER BY v`)
          .all(...args) as { v: string }[]
      ).map((r) => r.v);
    }
    return result;
  });

  return NextResponse.json(out);
}
