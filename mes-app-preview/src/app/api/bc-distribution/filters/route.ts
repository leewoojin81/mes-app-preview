import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildBcDistributionWhere } from "@/lib/bc-distribution-filters";

export const runtime = "nodejs";

// 상단 몰드코드/형명 드롭다운 옵션. 2026-08-26 사용자 요청으로 "몰드코드 우선" 필터로
// 바꿨다(직경 분포 분석/QC-03과 동일) — 몰드코드는 작업일자 기간에만 걸리고(형명 선택과
// 무관하게 항상 전체 몰드코드가 보여야 형명 없이도 몰드코드부터 바로 고를 수 있다),
// 형명은 선택된 몰드코드(+기간) 안에서 실제 존재하는 형명만 보여준다(이전엔 반대
// 방향이었음). 몰드코드는 daily_work_status에 없는 값이라 item_code 단위로
// dosu_change_status의 조립투입품목(조립투입품목명에 "몰드"가 들어간 행)으로 매핑해
// 얻는다 — /api/bc-distribution 본문 라우트와 같은 매핑 방식.
export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const moldFilter = params.get("mold");

  // 날짜 범위만 건 전체 item_code(형명·몰드 선택과 무관) — 몰드코드 옵션은 항상 이
  // 전체 범위 기준으로 보여준다.
  const { where: dateOnlyWhere, args: dateOnlyArgs } = buildBcDistributionWhere(params, {
    skipParams: ["model", "mold"],
  });
  const allItemRows = db
    .prepare(`SELECT DISTINCT item_code as v FROM daily_work_status ${dateOnlyWhere}`)
    .all(...dateOnlyArgs) as { v: string | null }[];
  const allItemCodes = allItemRows.map((r) => r.v).filter((v): v is string => v != null && v !== "");

  const moldByItem = new Map<string, string>();
  if (allItemCodes.length > 0) {
    const placeholders = allItemCodes.map(() => "?").join(",");
    const moldRows = db
      .prepare(
        `SELECT DISTINCT item_code, json_extract(detail, '$."조립투입품목"') as mold
         FROM dosu_change_status
         WHERE item_code IN (${placeholders})
           AND json_extract(detail, '$."조립투입품목명"') LIKE '%몰드%'`
      )
      .all(...allItemCodes) as { item_code: string; mold: string | null }[];
    for (const r of moldRows) {
      if (r.mold) moldByItem.set(r.item_code, r.mold);
    }
  }
  const molds = [...new Set(moldByItem.values())].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  // 형명 옵션은 몰드코드가 선택돼 있으면 그 몰드코드로 매핑되는 item_code만 반영한다
  // (몰드코드 우선). 몰드코드 미선택이면 날짜 범위 전체 item_code를 그대로 쓴다.
  const itemCodesForModel = moldFilter
    ? allItemCodes.filter((code) => moldByItem.get(code) === moldFilter)
    : allItemCodes;

  let models: string[] = [];
  if (itemCodesForModel.length > 0) {
    const placeholders = itemCodesForModel.map(() => "?").join(",");
    const modelCond = `json_extract(detail, '$."형명"') IS NOT NULL AND json_extract(detail, '$."형명"') != ''`;
    const modelRows = db
      .prepare(
        `SELECT DISTINCT json_extract(detail, '$."형명"') as v FROM daily_work_status
         WHERE item_code IN (${placeholders}) AND ${modelCond}`
      )
      .all(...itemCodesForModel) as { v: string | null }[];
    models = modelRows
      .map((r) => r.v)
      // 원본 엑셀에 드물게 섞인 깨진 제어문자 한 글자짜리 값(예: U+0080)을 걸러내려면
      // 단순 빈 문자열 체크로는 부족하다 — 영문/숫자/한글이 하나라도 있어야 진짜 값으로 본다.
      .filter((v): v is string => v != null && /[0-9A-Za-z가-힣]/.test(v))
      .sort((a, b) => a.localeCompare(b));
  }

  return NextResponse.json({ models, molds });
}
