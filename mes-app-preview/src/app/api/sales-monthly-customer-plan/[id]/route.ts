import { NextRequest, NextResponse } from "next/server";
import { getDb, nowLocal } from "@/lib/db";
import { isTempCustomerCode, tempCustomerCode } from "@/lib/temp-customer";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const existing = db.prepare("SELECT * FROM sales_monthly_customer_plan WHERE id = ?").get(id);
  if (!existing) {
    return NextResponse.json({ error: "대상을 찾을 수 없습니다." }, { status: 404 });
  }

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
  const dup = db
    .prepare(
      "SELECT 1 FROM sales_monthly_customer_plan WHERE year = ? AND month = ? AND customer_code = ? AND id != ?"
    )
    .get(year, month, customerCode, id);
  if (dup) {
    return NextResponse.json(
      { error: "이미 등록된 연도/월/고객사 조합입니다." },
      { status: 409 }
    );
  }

  db.prepare(
    `UPDATE sales_monthly_customer_plan
     SET year = ?, month = ?, customer_code = ?, qty = ?, updated_at = ?
     WHERE id = ?`
  ).run(year, month, customerCode, qty, nowLocal(db), id);

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.prepare("DELETE FROM sales_monthly_customer_plan WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
