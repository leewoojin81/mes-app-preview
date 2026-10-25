import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { getPackingList } from "@/lib/packing-list";
import { packingListExcel } from "@/lib/packing-list-excel";

export const runtime = "nodejs";

// Packing List(SALES-04) 엑셀 다운로드 — GET /api/packing-list/export?pl=PL...  (양식은 Packing List의 form: std / cn)
export async function GET(req: NextRequest) {
  const plNo = req.nextUrl.searchParams.get("pl")?.trim();
  const pl = plNo ? getPackingList(getDb(), plNo) : null;
  if (!pl) return NextResponse.json({ error: "Packing List가 없습니다." }, { status: 404 });
  const { buffer, filename } = await packingListExcel(pl);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}
