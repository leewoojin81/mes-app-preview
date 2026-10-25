import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { filterShipLotGrid, shipLotGrid } from "@/lib/ship-lot";

export const runtime = "nodejs";

// 출하LOT 배포용 엑셀 — GET /api/packing-list/ship-lot/export?q=&unissued=1&hideDone=1  (화면 그리드와 같은 열·조건)
const COLS: { header: string; key: string; width: number }[] = [
  { header: "순위", key: "rank", width: 6 },
  { header: "SO번호", key: "so_no", width: 17 },
  { header: "MO번호", key: "mo_no", width: 14 },
  { header: "고객사", key: "customer", width: 22 },
  { header: "브랜드", key: "brand", width: 18 },
  { header: "주문량", key: "order_qty", width: 10 },
  { header: "납기일자", key: "due_date", width: 12 },
  { header: "출하LOT", key: "lot_no", width: 10 },
  { header: "제조일자", key: "prod_text", width: 13 },
  { header: "사용기한", key: "expiry_text", width: 13 },
  { header: "국가", key: "country", width: 10 },
  { header: "영업담당자", key: "sales_manager", width: 11 },
  { header: "배포자", key: "issued_by", width: 10 },
  { header: "배포일시", key: "issued_at", width: 17 },
];

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const rows = filterShipLotGrid(shipLotGrid(getDb()), { q: sp.get("q") ?? "", unissued: sp.get("unissued") === "1", hideDone: sp.get("hideDone") === "1" });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("출하LOT");
  ws.columns = COLS;
  for (const r of rows) ws.addRow({ ...r, rank: r.done ? "완료" : r.rank });
  ws.getColumn("order_qty").numFmt = "#,##0";
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { horizontal: "center" };
  head.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } }));
  ws.eachRow((row) =>
    row.eachCell((c) => (c.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } }))
  );
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const buffer = await wb.xlsx.writeBuffer();
  const filename = `출하LOT_${new Date().toLocaleDateString("sv-SE").replace(/-/g, "")}.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
