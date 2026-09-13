// MOLD입고현황(INV-04) 목록/엑셀다운로드 API가 공유하는 WHERE 절 빌더.

function detailExpr(key: string): string {
  return `json_extract(detail, '$."${key}"')`;
}

export function buildMoldReceiptWhere(params: URLSearchParams): {
  where: string;
  args: string[];
} {
  const conditions: string[] = [];
  const args: string[] = [];

  const dateFrom = params.get("dateFrom");
  if (dateFrom) {
    conditions.push("receipt_date >= ?");
    args.push(dateFrom);
  }
  const dateTo = params.get("dateTo");
  if (dateTo) {
    conditions.push("receipt_date <= ?");
    args.push(dateTo);
  }
  const group = params.get("group");
  if (group) {
    conditions.push(`${detailExpr("품목군")} = ?`);
    args.push(group);
  }
  const search = params.get("search")?.trim();
  if (search) {
    conditions.push(
      `(item_code LIKE ? OR receipt_no LIKE ? OR lot_no LIKE ? OR ${detailExpr("품목정보")} LIKE ? OR ${detailExpr("고객사LOT No")} LIKE ? OR ${detailExpr("형명")} LIKE ?)`
    );
    args.push(
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
      `%${search}%`
    );
  }

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", args };
}
