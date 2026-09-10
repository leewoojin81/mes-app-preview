import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { SalesOrder } from "@/lib/types";
import { SALES_ORDER_DETAIL_COLS, salesOrderFallbackCell } from "@/lib/sales-order-columns";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

const SELECT_JOINED = `SELECT so.*, c.customer_name as customer_name, it.item_name as item_name
     FROM sales_orders so
       JOIN customers c ON c.customer_code = so.customer_code
       JOIN items it ON it.item_code = so.item_code`;

// 수주일자 = 원본 엑셀의 "수주일자"(YYYY.MM.DD → YYYY-MM-DD). 수동 등록분(detail 없음)은
// 별도 수주일자가 없어 등록일(created_at)의 날짜 부분으로 대체한다. api/sales-orders/route.ts 와 동일.
const ORDER_DATE_EXPR = `COALESCE(NULLIF(replace(json_extract(so.detail, '$.수주일자'), '.', '-'), ''), substr(so.created_at, 1, 10))`;

// 상태 필터 기준도 화면과 동일하게 원본 엑셀 "상태" 우선, 없으면 내부 워크플로 상태로 대체.
// api/sales-orders/route.ts 와 동일.
const STATUS_EXPR = `COALESCE(json_extract(so.detail, '$.상태'), so.status)`;

// 현재 화면 필터(상태·거래처·수주번호·수주일자) 조건에 해당하는 수주를 원본 엑셀
// 컬럼 그대로 xlsx로 내려준다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const statusParam = params.get("status");
  const customerParam = params.get("customer");
  const soNoParam = params.get("soNo");
  const dateFromParam = params.get("dateFrom");
  const dateToParam = params.get("dateTo");

  const conditions: string[] = [];
  const args: string[] = [];
  if (statusParam) {
    const statuses = statusParam.split(",").map((s) => s.trim());
    conditions.push(`${STATUS_EXPR} IN (${statuses.map(() => "?").join(",")})`);
    args.push(...statuses);
  }
  if (customerParam) {
    conditions.push("(so.customer_code LIKE ? OR c.customer_name LIKE ?)");
    args.push(`%${customerParam}%`, `%${customerParam}%`);
  }
  if (soNoParam) {
    conditions.push("so.so_no LIKE ?");
    args.push(`%${soNoParam}%`);
  }
  if (dateFromParam) {
    conditions.push(`${ORDER_DATE_EXPR} >= ?`);
    args.push(dateFromParam);
  }
  if (dateToParam) {
    conditions.push(`${ORDER_DATE_EXPR} <= ?`);
    args.push(dateToParam);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db
    .prepare(`${SELECT_JOINED} ${where} ORDER BY so.created_at DESC, so.so_no DESC`)
    .all(...args) as (Omit<SalesOrder, "detail"> & { detail: string | null })[];

  // 컬럼 제목("순번"처럼 중복되는 것 포함)이 원본 엑셀과 그대로 일치해야 하므로,
  // 객체 키 기반(json_to_sheet)이 아니라 위치 기반(aoa_to_sheet)으로 시트를 만든다.
  const header = ["수주번호", ...SALES_ORDER_DETAIL_COLS.map((c) => c.title)];
  const aoa: (string | number | null)[][] = [header];
  for (const r of rows) {
    const detail = r.detail
      ? (JSON.parse(r.detail) as Record<string, string | number | null>)
      : null;
    const so: SalesOrder = { ...r, detail };
    const rowValues: (string | number | null)[] = [detail?.["수주번호"] ?? so.so_no];
    for (const col of SALES_ORDER_DETAIL_COLS) {
      rowValues.push(detail?.[col.key] ?? salesOrderFallbackCell(so, col.key));
    }
    aoa.push(rowValues);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "수주현황");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `sales-orders_${stamp}.xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
