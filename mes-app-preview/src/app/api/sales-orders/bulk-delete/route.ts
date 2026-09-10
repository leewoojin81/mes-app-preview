import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// 목록 화면에서 선택(또는 한 수주번호에 속한 여러 줄)한 so_no들을 한 번에 삭제한다.
// 대량등록으로 만든 수주는 한 수주번호 아래 여러 줄(so_no = "수주번호-순번")로 저장되므로,
// 목록에서 "삭제"를 누르면 그 수주에 속한 줄 전체를 이 API로 함께 지운다.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const soNos = (body as { so_nos?: string[] } | null)?.so_nos;
  if (!Array.isArray(soNos) || soNos.length === 0) {
    return NextResponse.json({ error: "삭제할 수주가 없습니다." }, { status: 400 });
  }

  const db = getDb();
  const placeholders = soNos.map(() => "?").join(",");
  const result = db
    .prepare(`DELETE FROM sales_orders WHERE so_no IN (${placeholders})`)
    .run(...soNos);

  return NextResponse.json({ deleted: result.changes });
}
