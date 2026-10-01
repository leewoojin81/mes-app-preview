import { NextRequest, NextResponse } from "next/server";
import { getDb, nowLocal } from "@/lib/db";
import { isTempCustomerCode, tempCustomerCode } from "@/lib/temp-customer";

export const runtime = "nodejs";

// 영업관리 "월별수주(목표) 등록(SALES-01)" — 연/월/고객사별 수주 목표수량 목록.
export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.id, p.year, p.month, p.customer_code,
              COALESCE(c.customer_name, SUBSTR(p.customer_code, 5)) AS customer_name,
              CASE WHEN p.customer_code LIKE 'TMP:%' THEN 1 ELSE 0 END AS is_temp,
              p.qty, p.updated_at
       FROM sales_monthly_customer_plan p
       LEFT JOIN customers c ON c.customer_code = p.customer_code
       ORDER BY p.year DESC, p.month DESC, customer_name`
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
  // 화면에서 고객사 목록에 없는 이름을 입력했으면(new_customer_name) 고객사 마스터에는 저장하지 않고
  // 목표 행에만 임시 거래처("TMP:이름")로 남긴다. 거래처가 확정되면 이 목표를 수정해 실제 거래처로 바꾼다.
  const newCustomerName = typeof body.new_customer_name === "string" ? body.new_customer_name.trim() : "";
  const customerCode =
    newCustomerName && !String(body.customer_code ?? "").trim()
      ? tempCustomerCode(newCustomerName)
      : String(body.customer_code ?? "").trim();
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
  if (!isTempCustomerCode(customerCode) && !db.prepare("SELECT 1 FROM customers WHERE customer_code = ?").get(customerCode)) {
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
