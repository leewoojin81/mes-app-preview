import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildDosuChangeWhere } from "@/lib/dosu-change-filters";
import { DOSU_CHANGE_MOLD_CODES } from "@/lib/dosu-change-columns";

export const runtime = "nodejs";

interface RawGroup {
  group: string;
  count: number;
  total: number;
}

// 몰드(조립투입품목 중 "몰드"가 들어간 품목명의 코드) 기준 그룹 집계 — dosu_change_status
// 하나만 조회하면 되므로 SQL GROUP BY로 바로 집계한다.
function aggregateByMold(db: ReturnType<typeof getDb>, params: URLSearchParams): RawGroup[] {
  const moldCond = `json_extract(detail, '$."조립투입품목명"') LIKE '%몰드%'`;

  const changedParams = new URLSearchParams(params);
  changedParams.set("changedOnly", "1");
  const { where: changedWhere, args: changedArgs } = buildDosuChangeWhere(changedParams, {
    skipParam: "mold",
  });
  const changedFullWhere = changedWhere ? `${changedWhere} AND ${moldCond}` : `WHERE ${moldCond}`;
  const changedRows = db
    .prepare(
      `SELECT json_extract(detail, '$."조립투입품목"') as grp, COUNT(DISTINCT wo_no) as cnt
       FROM dosu_change_status ${changedFullWhere} GROUP BY grp`
    )
    .all(...changedArgs) as { grp: string | null; cnt: number }[];

  const { where: totalWhere, args: totalArgs } = buildDosuChangeWhere(params, { skipParam: "mold" });
  const totalFullWhere = totalWhere ? `${totalWhere} AND ${moldCond}` : `WHERE ${moldCond}`;
  const totalRows = db
    .prepare(
      `SELECT json_extract(detail, '$."조립투입품목"') as grp, COUNT(DISTINCT wo_no) as cnt
       FROM dosu_change_status ${totalFullWhere} GROUP BY grp`
    )
    .all(...totalArgs) as { grp: string | null; cnt: number }[];
  const totalByGrp = new Map(
    totalRows.filter((r): r is { grp: string; cnt: number } => !!r.grp).map((r) => [r.grp, r.cnt])
  );
  const changedByGrp = new Map(
    changedRows.filter((r): r is { grp: string; cnt: number } => !!r.grp).map((r) => [r.grp, r.cnt])
  );

  // 고정 몰드 목록을 먼저 0건으로 채워, 조회 기간에 검사/조립 실적이 아예 없던 몰드도
  // 항상 랭킹에 나오게 한다(그 뒤 실제로 나온 값으로 덮어씀). 목록에 없는 몰드가 실제
  // 데이터에 있으면(신규 몰드 등) 놓치지 않도록 뒤에 추가한다.
  const byGroup = new Map<string, RawGroup>();
  for (const code of DOSU_CHANGE_MOLD_CODES) {
    byGroup.set(code, { group: code, count: 0, total: 0 });
  }
  for (const [grp, total] of totalByGrp) {
    byGroup.set(grp, { group: grp, count: byGroup.get(grp)?.count ?? 0, total });
  }
  for (const [grp, count] of changedByGrp) {
    const cur = byGroup.get(grp) ?? { group: grp, count: 0, total: 0 };
    byGroup.set(grp, { ...cur, count });
  }

  return [...byGroup.values()];
}

// 형명(품목마스터 items의 속성) 기준 그룹 집계 — dosu_change_status엔 없는 값이라 items를
// 조인하면 item_code/detail 컬럼명이 겹쳐 별칭 없이 재사용 중인 buildDosuChangeWhere와
// 충돌한다. item_code 단위로 먼저 집계한 뒤 items에서 형명 매핑을 가져와 JS로 합산한다.
function aggregateByModel(db: ReturnType<typeof getDb>, params: URLSearchParams): RawGroup[] {
  const changedParams = new URLSearchParams(params);
  changedParams.set("changedOnly", "1");
  const { where: changedWhere, args: changedArgs } = buildDosuChangeWhere(changedParams, {
    skipParam: "model",
  });
  const changedByItem = db
    .prepare(
      `SELECT item_code, COUNT(DISTINCT wo_no) as cnt FROM dosu_change_status ${changedWhere} GROUP BY item_code`
    )
    .all(...changedArgs) as { item_code: string; cnt: number }[];

  const { where: totalWhere, args: totalArgs } = buildDosuChangeWhere(params, {
    skipParam: "model",
  });
  const totalByItem = db
    .prepare(
      `SELECT item_code, COUNT(DISTINCT wo_no) as cnt FROM dosu_change_status ${totalWhere} GROUP BY item_code`
    )
    .all(...totalArgs) as { item_code: string; cnt: number }[];

  const itemCodes = [
    ...new Set([...changedByItem.map((r) => r.item_code), ...totalByItem.map((r) => r.item_code)]),
  ];
  const modelByItem = new Map<string, string>();
  if (itemCodes.length > 0) {
    const placeholders = itemCodes.map(() => "?").join(",");
    const modelRows = db
      .prepare(
        `SELECT item_code, json_extract(detail, '$."형명"') as model FROM items WHERE item_code IN (${placeholders})`
      )
      .all(...itemCodes) as { item_code: string; model: string | null }[];
    for (const r of modelRows) modelByItem.set(r.item_code, r.model ?? "");
  }

  const changedByGrp = new Map<string, number>();
  for (const r of changedByItem) {
    const grp = modelByItem.get(r.item_code);
    if (!grp) continue;
    changedByGrp.set(grp, (changedByGrp.get(grp) ?? 0) + r.cnt);
  }
  const totalByGrp = new Map<string, number>();
  for (const r of totalByItem) {
    const grp = modelByItem.get(r.item_code);
    if (!grp) continue;
    totalByGrp.set(grp, (totalByGrp.get(grp) ?? 0) + r.cnt);
  }

  return [...changedByGrp.entries()].map(([group, count]) => ({
    group,
    count,
    total: totalByGrp.get(group) ?? count,
  }));
}

// 도수변경현황(QC-01) "몰드품목/형명별 변경율 랭킹" 파레토 분석용 — 변경건수
// 내림차순으로 정렬하고, 그룹별 변경율(그 그룹 자체 조립실적 대비)과 누적건수·누적비율
// (전체 변경건수 대비)을 함께 계산한다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const dim = params.get("dim") === "model" ? "model" : "mold";

  const raw = dim === "mold" ? aggregateByMold(db, params) : aggregateByModel(db, params);
  raw.sort((a, b) => b.count - a.count);

  const grandTotal = raw.reduce((sum, r) => sum + r.count, 0);
  let cum = 0;
  const rows = raw.map((r) => {
    cum += r.count;
    return {
      group: r.group,
      total: r.total,
      count: r.count,
      rate: r.total > 0 ? Math.round((r.count / r.total) * 1000) / 10 : 0,
      cumCount: cum,
      cumRate: grandTotal > 0 ? Math.round((cum / grandTotal) * 1000) / 10 : 0,
    };
  });

  return NextResponse.json({ dim, rows, grandTotal });
}
