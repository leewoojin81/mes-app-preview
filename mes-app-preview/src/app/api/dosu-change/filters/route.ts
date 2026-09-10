import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildDosuChangeWhere } from "@/lib/dosu-change-filters";

export const runtime = "nodejs";

// 도수변경현황(QC-01) 상단 몰드/형명 드롭다운 옵션 — 각 필드의 옵션은 자기
// 자신을 제외한 나머지 필터를 적용한 상태에서 실제 존재하는 값만 반환한다(faceted),
// 일일작업현황(PROD-10)과 같은 방식. 형명은 dosu_change_status에 없는 품목 속성이라
// items를 서브쿼리로 참조한다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;

  // 몰드 후보 행 — 조립투입품목명에 "몰드"가 들어간 행만(그 값이 실제 몰드 코드다).
  const { where: moldWhere, args: moldArgs } = buildDosuChangeWhere(params, {
    skipParam: "mold",
  });
  const moldMoldCond = `json_extract(detail, '$."조립투입품목명"') LIKE '%몰드%'`;
  const moldFullWhere = moldWhere ? `${moldWhere} AND ${moldMoldCond}` : `WHERE ${moldMoldCond}`;
  const moldRows = db
    .prepare(
      `SELECT DISTINCT json_extract(detail, '$."조립투입품목"') as v FROM dosu_change_status ${moldFullWhere}`
    )
    .all(...moldArgs) as { v: string | null }[];
  const mold = moldRows
    .map((r) => r.v)
    .filter((v): v is string => v != null && v !== "")
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const { where: modelWhere, args: modelArgs } = buildDosuChangeWhere(params, {
    skipParam: "model",
  });
  const modelRows = db
    .prepare(
      `SELECT DISTINCT json_extract(detail, '$."형명"') as v FROM items
       WHERE item_code IN (SELECT item_code FROM dosu_change_status ${modelWhere})`
    )
    .all(...modelArgs) as { v: string | null }[];
  const model = modelRows
    .map((r) => r.v)
    .filter((v): v is string => v != null && v !== "")
    .sort((a, b) => a.localeCompare(b));

  return NextResponse.json({ mold, model });
}
