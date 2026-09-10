// 구매입고등록(PUR-02) 목록/엑셀다운로드 API가 공유하는 WHERE 절 빌더.

function detailExpr(key: string): string {
  return `json_extract(detail, '$."${key}"')`;
}

export function buildPurchaseReceiptWhere(params: URLSearchParams): {
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
  const gubun = params.get("gubun");
  if (gubun) {
    conditions.push(`${detailExpr("구분")} = ?`);
    args.push(gubun);
  }
  const search = params.get("search")?.trim();
  if (search) {
    conditions.push(
      `(item_code LIKE ? OR receipt_no LIKE ? OR lot_no LIKE ? OR ${detailExpr("거래처명")} LIKE ? OR ${detailExpr("품목정보")} LIKE ? OR ${detailExpr("조달처명")} LIKE ?)`
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
