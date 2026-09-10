// 구매발주등록(PUR-01) 목록/엑셀다운로드 API가 공유하는 WHERE 절 빌더.

function detailExpr(key: string): string {
  return `json_extract(detail, '$."${key}"')`;
}

export function buildPurchaseOrderWhere(params: URLSearchParams): {
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
  const status = params.get("status");
  if (status) {
    conditions.push(`${detailExpr("상태")} = ?`);
    args.push(status);
  }
  const search = params.get("search")?.trim();
  if (search) {
    conditions.push(
      `(item_code LIKE ? OR po_no LIKE ? OR ${detailExpr("거래처명")} LIKE ? OR ${detailExpr("품목정보")} LIKE ? OR ${detailExpr("조달처명")} LIKE ?)`
    );
    args.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", args };
}
