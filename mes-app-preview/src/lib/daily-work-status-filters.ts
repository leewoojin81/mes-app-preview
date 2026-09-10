// 일일작업현황(PROD-10) 목록/필터옵션/엑셀다운로드 API가 공유하는 FROM·WHERE 절 빌더.
//
// 원본 ERP 엑셀(d_pmmr810)의 "라인" 컬럼은 실제로는 개별 설비명이다(예: "자동Base
// 2호기"). 그래서 화면의 "설비" 필터는 이 컬럼을 그대로 쓰고, 더 상위 그룹인
// "라인"(사출라인/착색라인/조립라인)은 설비등록(BASE-04) 데이터의
// equipment_name -> line_id 매핑을 조인해서 얻는다. 품목계정/대분류/중분류/소분류는
// 원본 실적 로그에 없어 품목등록(BASE-01) 데이터를 item_code로 조인해 가져온다.

export const DAILY_WORK_STATUS_JOIN = `
  FROM daily_work_status d
  LEFT JOIN equipments eq ON eq.equipment_name = json_extract(d.detail, '$."라인"')
  LEFT JOIN items i ON i.item_code = d.item_code
`;

function detailExprD(key: string): string {
  return `json_extract(d.detail, '$."${key}"')`;
}
function detailExprI(key: string): string {
  return `json_extract(i.detail, '$."${key}"')`;
}

export const DAILY_WORK_STATUS_DROPDOWN_FILTERS = [
  { param: "line", label: "라인", expr: "eq.line_id" },
  { param: "equipment", label: "설비", expr: detailExprD("라인") },
  { param: "process", label: "공정", expr: detailExprD("공정명") },
  { param: "acct", label: "품목계정", expr: detailExprI("품목계정") },
  { param: "cat1", label: "대분류", expr: detailExprI("대분류") },
  { param: "cat2", label: "중분류", expr: detailExprI("중분류") },
  { param: "cat3", label: "소분류", expr: detailExprI("소분류") },
] as const;

export type DailyWorkStatusFilterParam =
  (typeof DAILY_WORK_STATUS_DROPDOWN_FILTERS)[number]["param"];

export function buildDailyWorkStatusWhere(
  params: URLSearchParams,
  opts?: { skipParam?: DailyWorkStatusFilterParam }
): { where: string; args: string[] } {
  const conditions: string[] = [];
  const args: string[] = [];

  const dateFrom = params.get("dateFrom");
  if (dateFrom) {
    conditions.push("d.work_date >= ?");
    args.push(dateFrom);
  }
  const dateTo = params.get("dateTo");
  if (dateTo) {
    conditions.push("d.work_date <= ?");
    args.push(dateTo);
  }

  for (const f of DAILY_WORK_STATUS_DROPDOWN_FILTERS) {
    if (opts?.skipParam === f.param) continue;
    const v = params.get(f.param);
    if (v) {
      conditions.push(`${f.expr} = ?`);
      args.push(v);
    }
  }

  const itemGroup = params.get("itemGroup")?.trim();
  if (itemGroup) {
    conditions.push(`${detailExprD("품목군")} LIKE ?`);
    args.push(`%${itemGroup}%`);
  }
  const itemCode = params.get("itemCode")?.trim();
  if (itemCode) {
    conditions.push("d.item_code LIKE ?");
    args.push(`%${itemCode}%`);
  }
  const woNo = params.get("woNo")?.trim();
  if (woNo) {
    conditions.push("d.wo_no LIKE ?");
    args.push(`%${woNo}%`);
  }
  const lotNo = params.get("lotNo")?.trim();
  if (lotNo) {
    conditions.push("d.lot_no LIKE ?");
    args.push(`%${lotNo}%`);
  }

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", args };
}
