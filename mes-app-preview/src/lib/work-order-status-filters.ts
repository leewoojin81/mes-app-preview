// 작업지시현황(PROD-05) 목록/엑셀다운로드 API가 공유하는 WHERE 절 빌더.

function detailExpr(key: string): string {
  return `json_extract(detail, '$."${key}"')`;
}

export function buildWorkOrderStatusWhere(params: URLSearchParams): {
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
  const line = params.get("line");
  if (line) {
    conditions.push(`${detailExpr("라인")} = ?`);
    args.push(line);
  }
  const status = params.get("status");
  if (status) {
    conditions.push(`${detailExpr("상태")} = ?`);
    args.push(status);
  }
  const search = params.get("search")?.trim();
  if (search) {
    conditions.push(
      `(item_code LIKE ? OR wo_no LIKE ? OR lot_no LIKE ? OR so_no LIKE ? OR ${detailExpr("품목정보")} LIKE ?)`
    );
    args.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", args };
}
