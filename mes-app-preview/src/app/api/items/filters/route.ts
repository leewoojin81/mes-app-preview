import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { DETAIL_FILTERS, buildItemWhere, detailExpr } from "@/lib/item-filters";

export const runtime = "nodejs";

// 값이 공백·제어문자(원본 엑셀에 U+0080, NBSP 등이 섞여 있음)뿐이면 옵션에서 제외
const HAS_VISIBLE_CHAR = new RegExp("[^\\s\\u0000-\\u001f\\u007f-\\u00a0]");

// 품목계정/대분류/중분류/소분류 드롭다운 옵션.
// 각 필드의 옵션은 자기 자신을 제외한 나머지 조건(분류 탭·검색어·다른 필터)을
// 적용한 상태에서 실제 존재하는 값만 반환한다(faceted).
export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;

  const out: Record<string, string[]> = {};
  for (const f of DETAIL_FILTERS) {
    const { where, args } = buildItemWhere(params, { skipParam: f.param });
    const expr = detailExpr(f.key);
    const cond = where
      ? `${where} AND ${expr} IS NOT NULL`
      : `WHERE ${expr} IS NOT NULL`;
    out[f.param] = (
      db
        .prepare(`SELECT DISTINCT ${expr} AS v FROM items ${cond} ORDER BY v`)
        .all(...args) as { v: string }[]
    )
      .map((r) => r.v)
      .filter((v) => HAS_VISIBLE_CHAR.test(v));
  }
  return NextResponse.json(out);
}
