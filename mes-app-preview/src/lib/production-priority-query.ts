// 생산순위지정(PLAN-01) 목록/엑셀 다운로드/순위이동이 공유하는 조회 로직 —
// route.ts 는 GET 핸들러 외 다른 값을 export 할 수 없어(Next.js route 규칙) 별도 lib 로 분리.

// 수주(SALES-02)에 품목 마스터의 MODEL(형명)/포장방법/품목군, 그리고 이미 작업지시로 발행된
// 수량(작지수량)을 붙여서 내려준다.
export const PRIORITY_SELECT = `
  SELECT so.*, c.customer_name as customer_name, it.item_name as item_name,
         json_extract(it.detail, '$.형명') as model_name,
         json_extract(it.detail, '$.포장방법') as packing_method,
         json_extract(it.detail, '$.품목군') as item_group,
         COALESCE((SELECT SUM(wo.order_qty) FROM work_orders wo WHERE wo.so_no = so.so_no), 0) as issued_qty
  FROM sales_orders so
  JOIN customers c ON c.customer_code = so.customer_code
  JOIN items it ON it.item_code = so.item_code
`;

// 수주일자 = 원본 엑셀 "수주일자"(YYYY.MM.DD → YYYY-MM-DD). 수동 등록분은 등록일로 대체.
// api/sales-orders/route.ts 와 동일한 규칙.
export const ORDER_DATE_EXPR = `COALESCE(NULLIF(replace(json_extract(so.detail, '$.수주일자'), '.', '-'), ''), substr(so.created_at, 1, 10))`;

// 상태 기준 = 목록 화면(수주등록)과 동일하게 원본 엑셀 "상태" 우선, 없으면 내부 워크플로 상태로 대체.
// api/sales-orders/route.ts 와 동일한 규칙.
export const STATUS_EXPR = `COALESCE(json_extract(so.detail, '$.상태'), so.status)`;

// 생산순위지정은 아직 출고 전인 수주만 대상으로 한다 — 완료/중단 건은 항상 제외.
const LOAD_STATUSES = ["수주", "Packing", "출고"];

// 항상 작업순서 오름차순 — 미지정(NULL)은 맨 뒤로 보내고, 같은 순서 내에서는 so_no로 안정 정렬한다.
export const PRIORITY_ORDER = `
  ORDER BY
    CASE WHEN json_extract(so.detail, '$.작업순서') IS NULL THEN 1 ELSE 0 END,
    CAST(json_extract(so.detail, '$.작업순서') AS INTEGER),
    so.so_no
`;

export function buildPriorityWhere(params: URLSearchParams): { where: string; args: string[] } {
  const soNoParam = params.get("soNo");
  const itemCodeParam = params.get("itemCode");
  const dateFromParam = params.get("dateFrom");
  const dateToParam = params.get("dateTo");

  const conditions: string[] = [`${STATUS_EXPR} IN (${LOAD_STATUSES.map(() => "?").join(",")})`];
  const args: string[] = [...LOAD_STATUSES];
  if (soNoParam) {
    conditions.push("(so.so_no LIKE ? OR json_extract(so.detail, '$.수주번호') LIKE ?)");
    args.push(`%${soNoParam}%`, `%${soNoParam}%`);
  }
  if (itemCodeParam) {
    conditions.push("(so.item_code LIKE ? OR json_extract(so.detail, '$.품목코드') LIKE ?)");
    args.push(`%${itemCodeParam}%`, `%${itemCodeParam}%`);
  }
  if (dateFromParam) {
    conditions.push(`${ORDER_DATE_EXPR} >= ?`);
    args.push(dateFromParam);
  }
  if (dateToParam) {
    conditions.push(`${ORDER_DATE_EXPR} <= ?`);
    args.push(dateToParam);
  }
  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", args };
}
