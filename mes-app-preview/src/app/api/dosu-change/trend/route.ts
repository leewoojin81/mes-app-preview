import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildDosuChangeWhere } from "@/lib/dosu-change-filters";

export const runtime = "nodejs";

// 서버 로컬 타임존 기준 YYYY-MM-DD. Date#toISOString()은 UTC로 변환하므로, 로컬
// 타임존이 UTC와 다르면(KST 등) 날짜가 하루 밀린다(예: dateFrom이 08-01인데 첫 구간이
// 07-31로 나옴) — 반드시 로컬 날짜 성분(getFullYear/getMonth/getDate)으로 조립한다.
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type Granularity = "day" | "week" | "month";

// 주별 집계의 버킷 키 = 그 날이 속한 주의 월요일(ISO 주 시작) 날짜. 월별은 "YYYY-MM".
function bucketKey(dateStr: string, granularity: Granularity): string {
  if (granularity === "day") return dateStr;
  const d = new Date(`${dateStr}T00:00:00`);
  if (granularity === "month") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  const dow = d.getDay(); // 0=일 ... 6=토
  const diffToMonday = (dow + 6) % 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - diffToMonday);
  return toLocalDateStr(monday);
}

// 품질관리 "도수변경현황(QC-01)" 화면용 — 도수변경등록(dosu_change_status)에서
// 검사일자(외관검사 일자)별 변경건수(이전도수가 채워진 행)와, 그 날 전체 조립 실적
// 대비 비율(변경건수 / 전체 조립실적건수 * 100)을 함께 집계한다. PROD-06 화면 자체는
// 지시일자(order_date) 기준이지만 이 화면은 검사일자(inspect_date) 기준이라
// inspectDateFrom/inspectDateTo 파라미터를 쓴다. 다른 필터(구분/검색)는 화면 필터와
// 그대로 맞추되, 변경건수는 changedOnly를 강제로 켜고 전체 건수는 끈 채로 각각 집계한다.
// 조립 LOT 하나가 투입자재(BASE·착색 등)별로 여러 행으로 나뉘어 있어(작업지시번호당
// 보통 3~4행) 행을 그대로 세면 실제 작업지시 건수보다 부풀려진다 — 작업지시번호
// 기준으로 유일하게 세야 실제 "몇 건의 지시에서 도수가 바뀌었는지"가 된다.
//
// granularity=day(기본)|week|month — 항상 일별로 먼저 집계한 뒤(위 이유로 SQL은 일별
// GROUP BY까지만) 필요하면 그 결과를 주/월 단위로 클라이언트... 가 아니라 여기 서버에서
// 다시 합산한다(변경율은 일별 rate를 평균 내면 안 되고, 반드시 그 구간의 건수 합계 /
// 전체실적 합계로 다시 계산해야 정확하다).
export async function GET(req: NextRequest) {
  const db = getDb();
  const baseParams = new URLSearchParams(req.nextUrl.searchParams);
  const granularityParam = baseParams.get("granularity");
  const granularity: Granularity =
    granularityParam === "week" ? "week" : granularityParam === "month" ? "month" : "day";

  const changedParams = new URLSearchParams(baseParams);
  changedParams.set("changedOnly", "1");
  const { where: changedWhere, args: changedArgs } = buildDosuChangeWhere(changedParams);
  const changedRows = db
    .prepare(
      `SELECT inspect_date as date, COUNT(DISTINCT wo_no) as cnt FROM dosu_change_status ${changedWhere} GROUP BY inspect_date`
    )
    .all(...changedArgs) as { date: string; cnt: number }[];
  const changedByDate = new Map(changedRows.map((r) => [r.date, r.cnt]));

  const { where: totalWhere, args: totalArgs } = buildDosuChangeWhere(baseParams);
  const totalRows = db
    .prepare(
      `SELECT inspect_date as date, COUNT(DISTINCT wo_no) as cnt FROM dosu_change_status ${totalWhere} GROUP BY inspect_date`
    )
    .all(...totalArgs) as { date: string; cnt: number }[];
  const totalByDate = new Map(totalRows.map((r) => [r.date, r.cnt]));

  // 조회 구간의 모든 날짜를 빠짐없이 채운다(변경이 없던 날은 0건/0%로) — 차트가
  // 날짜를 건너뛰지 않고 매일 동일한 간격으로 그려지도록. 주/월별일 땐 이 일별 목록을
  // 버킷별로 다시 합산한다.
  const dateFrom = baseParams.get("inspectDateFrom");
  const dateTo = baseParams.get("inspectDateTo");
  const bucketOrder: string[] = [];
  const bucketCount = new Map<string, number>();
  const bucketTotal = new Map<string, number>();
  if (dateFrom && dateTo) {
    const d = new Date(`${dateFrom}T00:00:00`);
    const end = new Date(`${dateTo}T00:00:00`);
    while (d <= end) {
      const iso = toLocalDateStr(d);
      const key = bucketKey(iso, granularity);
      if (!bucketCount.has(key)) {
        bucketOrder.push(key);
        bucketCount.set(key, 0);
        bucketTotal.set(key, 0);
      }
      bucketCount.set(key, bucketCount.get(key)! + (changedByDate.get(iso) ?? 0));
      bucketTotal.set(key, bucketTotal.get(key)! + (totalByDate.get(iso) ?? 0));
      d.setDate(d.getDate() + 1);
    }
  }

  const trend = bucketOrder.map((key) => {
    const count = bucketCount.get(key)!;
    const dayTotal = bucketTotal.get(key)!;
    const rate = dayTotal > 0 ? Math.round((count / dayTotal) * 1000) / 10 : 0;
    return { date: key, count, rate };
  });

  const total = trend.reduce((sum, t) => sum + t.count, 0);

  return NextResponse.json({ trend, total, granularity });
}
