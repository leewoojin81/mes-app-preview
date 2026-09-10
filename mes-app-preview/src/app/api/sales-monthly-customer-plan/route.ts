import { NextRequest, NextResponse } from "next/server";
import { getDb, nowLocal } from "@/lib/db";

export const runtime = "nodejs";

// 영업관리 "월별수주(목표) 등록(SALES-01)" — 연/월/고객사별 수주 목표수량 목록.
export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.id, p.year, p.month, p.customer_code, c.customer_name, p.qty, p.updated_at
       FROM sales_monthly_customer_plan p
       JOIN customers c ON c.customer_code = p.customer_code
       ORDER BY p.year DESC, p.month DESC, c.customer_name`
    )
    .all();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const year = Number(body.year);
  const month = Number(body.month);
  const customerCode = String(body.customer_code ?? "").trim();
  const qty = body.qty === "" || body.qty == null ? 0 : Number(body.qty);

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "연도가 올바르지 않습니다." }, { status: 400 });
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "월은 1~12 사이여야 합니다." }, { status: 400 });
  }
  if (!customerCode) {
    return NextResponse.json({ error: "고객사는 필수입니다." }, { status: 400 });
  }
  if (!Number.isFinite(qty) || qty < 0) {
    return NextResponse.json({ error: "수량이 올바르지 않습니다." }, { status: 400 });
  }
  if (!db.prepare("SELECT 1 FROM customers WHERE customer_code = ?").get(customerCode)) {
    return NextResponse.json({ error: "존재하지 않는 고객사입니다." }, { status: 400 });
  }
  if (
    db
      .prepare("SELECT 1 FROM sales_monthly_customer_plan WHERE year = ? AND month = ? AND customer_code = ?")
      .get(year, month, customerCode)
  ) {
    return NextResponse.json(
      { error: "이미 등록된 연도/월/고객사 조합입니다. 목록에서 수정해주세요." },
      { status: 409 }
    );
  }

  const now = nowLocal(db);
  db.prepare(
    `INSERT INTO sales_monthly_customer_plan (year, month, customer_code, qty, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(year, month, customerCode, qty, now, now);

  return NextResponse.json({ ok: true }, { status: 201 });
}
