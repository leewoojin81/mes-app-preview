// 현재고현황(INV-02) 목록/필터옵션 API가 공유하는 WHERE 절 빌더.
// 창고는 실제 컬럼, 품목계정/대분류/중분류/소분류는 원본 엑셀 컬럼(detail JSON)이라
// json_extract로 조회한다.

export const INVENTORY_STATUS_DETAIL_FILTERS = [
  { param: "acct", key: "품목계정" },
  { param: "cat1", key: "대분류" },
  { param: "cat2", key: "중분류" },
  { param: "cat3", key: "소분류" },
] as const;

export type InventoryStatusFilterParam =
  | (typeof INVENTORY_STATUS_DETAIL_FILTERS)[number]["param"]
  | "warehouse";

export function detailExpr(key: string): string {
  return `json_extract(detail, '$."${key}"')`;
}

export function buildInventoryStatusWhere(
  params: URLSearchParams,
  opts?: { skipParam?: InventoryStatusFilterParam }
): { where: string; args: string[] } {
  const conditions: string[] = [];
  const args: string[] = [];

  const warehouse = params.get("warehouse");
  if (warehouse && opts?.skipParam !== "warehouse") {
    conditions.push("warehouse = ?");
    args.push(warehouse);
  }
  for (const f of INVENTORY_STATUS_DETAIL_FILTERS) {
    if (opts?.skipParam === f.param) continue;
    const v = params.get(f.param);
    if (v) {
      conditions.push(`${detailExpr(f.key)} = ?`);
      args.push(v);
    }
  }
  const itemGroup = params.get("itemGroup");
  if (itemGroup) {
    conditions.push(`${detailExpr("품목군")} LIKE ?`);
    args.push(`%${itemGroup}%`);
  }
  const itemCode = params.get("itemCode");
  if (itemCode) {
    conditions.push("item_code LIKE ?");
    args.push(`%${itemCode}%`);
  }
  const lotNo = params.get("lotNo");
  if (lotNo) {
    conditions.push("lot_no LIKE ?");
    args.push(`%${lotNo}%`);
  }

  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", args };
}
