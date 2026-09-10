import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

interface DeductionInput {
  id?: unknown;
  qty?: unknown;
}

// 공정표발행(PROD-04)에서 "공정표 발행 확인" 화면의 "저장"을 누르면, 재고확인
// 팝업에서 체크해 뒀던 착색 반제품 LOT의 현재고현황(INV-02) 재고수량을 실제로
// 차감한다. inventory_status.id로 행을 정확히 지정해 그만큼만 뺀다(0 아래로는
// 내려가지 않는다).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const deductions = (body as { deductions?: DeductionInput[] } | null)?.deductions;
  if (!Array.isArray(deductions) || deductions.length === 0) {
    return NextResponse.json({ error: "차감할 내역이 없습니다." }, { status: 400 });
  }

  const db = getDb();
  const update = db.prepare(
    `UPDATE inventory_status SET stock_qty = MAX(0, COALESCE(stock_qty, 0) - ?) WHERE id = ?`
  );

  let applied = 0;
  const errors: string[] = [];

  db.exec("BEGIN");
  try {
    for (const d of deductions) {
      const id = Number(d.id);
      const qty = Number(d.qty);
      if (!Number.isFinite(id) || !Number.isFinite(qty) || qty <= 0) {
        errors.push(`잘못된 차감 요청입니다. (id=${String(d.id)})`);
        continue;
      }
      const info = update.run(qty, id);
      if (info.changes === 0) {
        errors.push(`재고 행을 찾을 수 없습니다. (id=${id})`);
        continue;
      }
      applied++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ applied, errors });
}
