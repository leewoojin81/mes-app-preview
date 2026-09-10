import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildDosuDistributionWhere, extractTargetDosu } from "@/lib/dosu-distribution-filters";

export const runtime = "nodejs";

// 상단 몰드코드/형명 드롭다운 옵션. B.C/직경 분포 분석과 동일한 "몰드코드 우선" 필터 —
// 몰드코드는 작업일자 기간에만 걸리고(형명 선택과 무관하게 항상 전체 몰드코드가 보여야
// 형명 없이도 몰드코드부터 바로 고를 수 있다), 형명은 선택된 몰드코드(+기간) 안에서
// 실제 존재하는 형명만 보여준다. 몰드코드는 daily_work_status에 없는 값이라 item_code
// 단위로 dosu_change_status의 조립투입품목(조립투입품목명에 "몰드"가 들어간 행)으로
// 매핑해 얻는다 — QC-01/02/03과 같은 방식.
export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const moldFilter = params.get("mold");

  const { where: dateOnlyWhere, args: dateOnlyArgs } = buildDosuDistributionWhere(params, {
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
      .filter((v): v is string => v != null && /[0-9A-Za-z가-힣]/.test(v))
      .sort((a, b) => a.localeCompare(b));
  }

  // 지시도수 옵션 — 몰드코드(선택 시)+형명(선택 시)+기간 안에 실제 존재하는 값만.
  // dosu는 다른 축(mold/model)을 좁히는 데 쓰지 않는 말단 축이라, 여기 아래에서만
  // (다른 옵션 계산에 영향 없이) 별도로 계산한다.
  const modelFilter = params.get("model");
  let itemCodesForDosu = itemCodesForModel;
  if (modelFilter) {
    if (itemCodesForModel.length === 0) {
      itemCodesForDosu = [];
    } else {
      const placeholders2 = itemCodesForModel.map(() => "?").join(",");
      const modelItemRows = db
        .prepare(
          `SELECT DISTINCT item_code FROM daily_work_status
           WHERE item_code IN (${placeholders2}) AND json_extract(detail, '$."형명"') = ?`
        )
        .all(...itemCodesForModel, modelFilter) as { item_code: string }[];
      itemCodesForDosu = modelItemRows.map((r) => r.item_code);
    }
  }
  const dosuSet = new Set<number>();
  for (const code of itemCodesForDosu) {
    const t = extractTargetDosu(code);
    if (t != null) dosuSet.add(t);
  }
  const dosuOptions = [...dosuSet].sort((a, b) => b - a);

  return NextResponse.json({ models, molds, dosuOptions });
}
