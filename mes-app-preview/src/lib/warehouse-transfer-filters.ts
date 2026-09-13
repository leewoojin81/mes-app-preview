// 창고이동현황(INV-05) 목록/엑셀다운로드 API가 공유하는 WHERE 절 빌더.

function detailExpr(key: string): string {
  return `json_extract(detail, '$."${key}"')`;
}

export function buildWarehouseTransferWhere(params: URLSearchParams): {
  where: string;
  args: string[];
} {
  const conditions: string[] = [];
  const args: string[] = [];

  const dateFrom = params.get("dateFrom");
  if (dateFrom) {
    conditions.push("transfer_date >= ?");
    args.push(dateFrom);
  }
  const dateTo = params.get("dateTo");
  if (dateTo) {
    conditions.push("transfer_date <= ?");
    args.push(dateTo);
  }
  const fromWarehouse = params.get("fromWarehouse");
  if (fromWarehouse) {
    conditions.push("from_warehouse = ?");
    args.push(fromWarehouse);
  }
  const toWarehouse = params.get("toWarehouse");
  if (toWarehouse) {
    conditions.push("to_warehouse = ?");
    args.push(toWarehouse);
  }
  const reason = params.get("reason");
  if (reason) {
    conditions.push(`${detailExpr("이동사유")} = ?`);
    args.push(reason);
  }
  const search = params.get("search")?.trim();
  if (search) {
    conditions.push(
      `(item_code LIKE ? OR transfer_no LIKE ? OR lot_no LIKE ? OR ${detailExpr("출고품목명")} LIKE ?)`
    );
    args.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", args };
}
