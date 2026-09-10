import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// 생산순위지정(PLAN-01) "계획제외" 일괄 체크/해제 — 현재 조회(검색) 결과에 뜬 so_no들을
// 한 번에 처리한다. 단건 PATCH(action=plan)와 같은 규칙으로 detail의 계획제외만 바꾸고
// 작업순서 등 나머지 값은 그대로 둔다.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const soNos = (body as { so_nos?: unknown[] } | null)?.so_nos;
  const exclude = (body as { exclude?: boolean } | null)?.exclude;
  if (!Array.isArray(soNos) || soNos.length === 0 || typeof exclude !== "boolean") {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const db = getDb();
  const select = db.prepare("SELECT detail FROM sales_orders WHERE so_no = ?");
  const update = db.prepare("UPDATE sales_orders SET detail = ? WHERE so_no = ?");

  let updated = 0;
  let skippedNotFound = 0;

  db.exec("BEGIN");
  try {
    for (const raw of soNos) {
      const so_no = String(raw);
      const row = select.get(so_no) as { detail: string | null } | undefined;
      if (!row) {
        skippedNotFound++;
        continue;
      }
      const existingDetail = row.detail
        ? (JSON.parse(row.detail) as Record<string, string | number | null>)
        : {};
      const detail = { ...existingDetail, 계획제외: exclude ? "Y" : "N" };
      update.run(JSON.stringify(detail), so_no);
      updated++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ updated, skippedNotFound });
}
