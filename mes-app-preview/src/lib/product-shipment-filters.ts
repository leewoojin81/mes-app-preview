// 제품출고등록(SALES-03) 목록/엑셀다운로드 API가 공유하는 WHERE 절 빌더.

function detailExpr(key: string): string {
  return `json_extract(detail, '$."${key}"')`;
}

export function buildProductShipmentWhere(params: URLSearchParams): {
  where: string;
  args: string[];
} {
  const conditions: string[] = [];
  const args: string[] = [];

  const dateFrom = params.get("dateFrom");
  if (dateFrom) {
    conditions.push("ship_date >= ?");
    args.push(dateFrom);
  }
  const dateTo = params.get("dateTo");
  if (dateTo) {
    conditions.push("ship_date <= ?");
    args.push(dateTo);
  }
  const saleType = params.get("saleType");
  if (saleType) {
    conditions.push(`${detailExpr("매출구분")} = ?`);
    args.push(saleType);
  }
  const search = params.get("search")?.trim();
  if (search) {
    conditions.push(
      `(item_code LIKE ? OR shipment_no LIKE ? OR so_no LIKE ? OR ${detailExpr("거래처명")} LIKE ? OR ${detailExpr("품목정보")} LIKE ? OR ${detailExpr("Lotno")} LIKE ?)`
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
