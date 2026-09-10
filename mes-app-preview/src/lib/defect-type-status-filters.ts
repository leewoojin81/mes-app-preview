// 불량종합현황(PROD-07) 목록/엑셀다운로드 API가 공유하는 WHERE 절 빌더.

function detailExpr(key: string): string {
  return `json_extract(detail, '$."${key}"')`;
}

export function buildDefectTypeStatusWhere(params: URLSearchParams): {
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
  const gubun = params.get("gubun");
  if (gubun) {
    conditions.push(`${detailExpr("구분")} = ?`);
    args.push(gubun);
  }
  const process = params.get("process");
  if (process) {
    conditions.push(`${detailExpr("공정명")} = ?`);
    args.push(process);
  }
  const search = params.get("search")?.trim();
  if (search) {
    conditions.push(
      `(item_code LIKE ? OR wo_no LIKE ? OR lot_no LIKE ? OR ${detailExpr("품목정보")} LIKE ? OR ${detailExpr("설비명")} LIKE ?)`
    );
    args.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", args };
}
