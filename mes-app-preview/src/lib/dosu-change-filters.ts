// 도수변경등록(PROD-06) 목록/엑셀다운로드 API와 도수변경현황(QC-01)이 공유하는
// WHERE 절 빌더.

function detailExpr(key: string): string {
  return `json_extract(detail, '$."${key}"')`;
}

export type DosuChangeFilterParam = "mold" | "model";

export function buildDosuChangeWhere(
  params: URLSearchParams,
  opts?: { skipParam?: DosuChangeFilterParam }
): {
  where: string;
  args: string[];
} {
  const conditions: string[] = [];
  const args: string[] = [];

  const dateFrom = params.get("dateFrom");
  if (dateFrom) {
    conditions.push("order_date >= ?");
    args.push(dateFrom);
  }
  const dateTo = params.get("dateTo");
  if (dateTo) {
    conditions.push("order_date <= ?");
    args.push(dateTo);
  }
  // 검사일자(외관검사 일자) 기준 필터 — PROD-06 화면 자체는 지시일자(dateFrom/dateTo)를
  // 쓰고, 품질관리 도수변경현황(QC-01)은 이쪽을 쓴다.
  const inspectDateFrom = params.get("inspectDateFrom");
  if (inspectDateFrom) {
    conditions.push("inspect_date >= ?");
    args.push(inspectDateFrom);
  }
  const inspectDateTo = params.get("inspectDateTo");
  if (inspectDateTo) {
    conditions.push("inspect_date <= ?");
    args.push(inspectDateTo);
  }
  const gubun = params.get("gubun");
  if (gubun) {
    conditions.push(`${detailExpr("주야간")} = ?`);
    args.push(gubun);
  }
  // 몰드 — 상몰드1/하몰드1(숫자, LOT성 식별자)이 아니라 조립투입품목 중 품목명에
  // "몰드"가 들어간 행의 조립투입품목 코드(예: "3860D" 하몰드)가 실제 몰드 종류다.
  // 조립 LOT 하나는 투입자재별(몰드·착색 등) 여러 행으로 나뉘어 있어, 이 조건은 그
  // 몰드가 쓰인 행만 골라낸다.
  const mold = params.get("mold");
  if (mold && opts?.skipParam !== "mold") {
    conditions.push(`${detailExpr("조립투입품목")} = ?`);
    args.push(mold);
  }
  // 형명 — dosu_change_status 자체엔 없는 품목 속성이라 품목마스터(items)를 서브쿼리로
  // 참조한다(JOIN 없이도 동작하도록 IN 절로 처리 — 다른 화면의 FROM 절을 안 건드림).
  const model = params.get("model");
  if (model && opts?.skipParam !== "model") {
    conditions.push(
      `item_code IN (SELECT item_code FROM items WHERE json_extract(detail, '$."형명"') = ?)`
    );
    args.push(model);
  }
  // "변경건만" — 원본 리포트는 조립 실적 전체를 담고 있고, 이전 지시와 다른 도수로
  // 조립된 행만 "이전도수"가 채워진다. 화면 기본값은 이 조건을 켠 상태로 시작한다.
  if (params.get("changedOnly") === "1") {
    conditions.push(`${detailExpr("이전도수")} IS NOT NULL AND ${detailExpr("이전도수")} != ''`);
  }
  const search = params.get("search")?.trim();
  if (search) {
    conditions.push(
      `(item_code LIKE ? OR wo_no LIKE ? OR lot_no LIKE ? OR ${detailExpr("품목정보")} LIKE ?)`
    );
    args.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", args };
}
