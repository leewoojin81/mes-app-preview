import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { strOrNull, strVal } from "@/lib/item-fields";

export const runtime = "nodejs";

function yn(v: unknown): "Y" | "N" {
  return v === "Y" ? "Y" : "N";
}

// 거래처 수정
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ customer_code: string }> }
) {
  const { customer_code: customerCode } = await params;
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM customers WHERE customer_code = ?")
    .get(customerCode);
  if (!existing) {
    return NextResponse.json({ error: "거래처를 찾을 수 없습니다." }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const customerName = strVal(body.customer_name);
  if (!customerName) {
    return NextResponse.json({ error: "거래처명은 필수입니다." }, { status: 400 });
  }

  db.prepare(
    `UPDATE customers SET
       customer_name=?, customer_type=?, biz_reg_no=?, ceo_name=?, zip_code=?, address=?,
       phone=?, fax=?, biz_type=?, biz_item=?, manager_name=?, settle_customer_code=?,
       settle_customer_name=?, trade_start_date=?, trade_end_date=?, category_large=?,
       category_mid=?, category_small=?, bank_name=?, bank_account=?, account_holder=?,
       website=?, is_purchase=?, is_outsourcing=?, is_sales=?, country=?, use_yn=?
     WHERE customer_code=?`
  ).run(
    customerName,
    strOrNull(body.customer_type),
    strOrNull(body.biz_reg_no),
    strOrNull(body.ceo_name),
    strOrNull(body.zip_code),
    strOrNull(body.address),
    strOrNull(body.phone),
    strOrNull(body.fax),
    strOrNull(body.biz_type),
    strOrNull(body.biz_item),
    strOrNull(body.manager_name),
    strOrNull(body.settle_customer_code),
    strOrNull(body.settle_customer_name),
    strOrNull(body.trade_start_date),
    strOrNull(body.trade_end_date),
    strOrNull(body.category_large),
    strOrNull(body.category_mid),
    strOrNull(body.category_small),
    strOrNull(body.bank_name),
    strOrNull(body.bank_account),
    strOrNull(body.account_holder),
    strOrNull(body.website),
    yn(body.is_purchase),
    yn(body.is_outsourcing),
    yn(body.is_sales),
    strOrNull(body.country),
    body.use_yn === "N" ? "N" : "Y",
    customerCode
  );

  return NextResponse.json({ ok: true });
}

// 거래처 삭제
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ customer_code: string }> }
) {
  const { customer_code: customerCode } = await params;
  const db = getDb();
  const result = db
    .prepare("DELETE FROM customers WHERE customer_code = ?")
    .run(customerCode);
  if (result.changes === 0) {
    return NextResponse.json({ error: "거래처를 찾을 수 없습니다." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
