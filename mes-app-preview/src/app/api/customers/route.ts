import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { numOrNull, strOrNull, strVal } from "@/lib/item-fields";

export const runtime = "nodejs";

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM customers ORDER BY customer_code")
    .all();
  return NextResponse.json(rows);
}

function yn(v: unknown): "Y" | "N" {
  return v === "Y" ? "Y" : "N";
}

// 거래처 등록
export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const customerCode = strVal(body.customer_code);
  const customerName = strVal(body.customer_name);
  if (!customerCode) {
    return NextResponse.json({ error: "거래처코드는 필수입니다." }, { status: 400 });
  }
  if (!customerName) {
    return NextResponse.json({ error: "거래처명은 필수입니다." }, { status: 400 });
  }
  if (db.prepare("SELECT 1 FROM customers WHERE customer_code = ?").get(customerCode)) {
    return NextResponse.json(
      { error: `이미 존재하는 거래처코드입니다: ${customerCode}` },
      { status: 409 }
    );
  }

  const seqInput = numOrNull(body.seq);
  if (seqInput === undefined) {
    return NextResponse.json({ error: "정렬은 숫자여야 합니다." }, { status: 400 });
  }
  let seq: number;
  if (seqInput === null) {
    const maxSeq = db.prepare("SELECT MAX(seq) AS m FROM customers").get() as {
      m: number | null;
    };
    seq = (maxSeq.m ?? 0) + 1;
  } else {
    seq = seqInput;
  }

  db.prepare(
    `INSERT INTO customers
       (customer_code, customer_name, customer_type, biz_reg_no, ceo_name, zip_code, address,
        phone, fax, biz_type, biz_item, manager_name, settle_customer_code, settle_customer_name,
        trade_start_date, trade_end_date, category_large, category_mid, category_small,
        bank_name, bank_account, account_holder, website, is_purchase, is_outsourcing, is_sales,
        country, seq, use_yn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    customerCode,
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
    seq,
    body.use_yn === "N" ? "N" : "Y"
  );

  return NextResponse.json({ ok: true, customer_code: customerCode }, { status: 201 });
}
