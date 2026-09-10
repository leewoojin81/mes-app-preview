import { NextRequest, NextResponse } from "next/server";
import { getDb, nextSoNo } from "@/lib/db";

export const runtime = "nodejs";

const VALID_STATUS = new Set(["수주", "Packing", "출고", "완료", "중단"]);

interface BulkRowInput {
  item_group?: string | null;
  rep_code?: string | null;
  item_code?: string | null;
  sales_type?: string | null;
  currency?: string | null;
  qty?: number | string | null;
  sample_type?: string | null;
  unit_price?: number | string | null;
  converted_amount?: number | string | null;
  due_date?: string | null;
  customer_code?: string | null;
  status?: string | null;
  remark?: string | null;
  mo_no?: string | null;
  order_date?: string | null;
  exchange_rate?: number | string | null;
}

function str(v: string | null | undefined): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}
function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/,/g, "").trim()) : v;
  return Number.isFinite(n) ? n : null;
}

// 대량등록 그리드(붙여넣기)에서 한 번에 여러 수주를 등록한다. 단건 등록(POST /api/sales-orders)과
// 같은 방식으로 detail JSON에 엑셀 업로드분과 동일한 컬럼명으로 부가 정보를 저장한다.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rows = (body as { rows?: BulkRowInput[] } | null)?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "등록할 행이 없습니다." }, { status: 400 });
  }

  const db = getDb();
  const custCodes = new Set(
    (db.prepare("SELECT customer_code FROM customers").all() as { customer_code: string }[]).map(
      (c) => c.customer_code
    )
  );
  const itemCodes = new Set(
    (db.prepare("SELECT item_code FROM items").all() as { item_code: string }[]).map(
      (i) => i.item_code
    )
  );

  const insert = db.prepare(
    `INSERT INTO sales_orders (so_no, customer_code, item_code, order_qty, unit_price, due_date, status, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  db.exec("BEGIN");
  try {
    // 한 번에 붙여넣어 저장하는 행은 전부 같은 수주(주문번호)에 속한 것으로 보고,
    // 수주번호 하나를 발급한 뒤 실제로 저장되는 행마다 "-순번"을 붙여 so_no를 구성한다
    // (엑셀 임포트분의 "수주번호-순번" 형식과 동일). 번호의 날짜 부분은 오늘이 아니라
    // 사용자가 그리드 상단에서 고른 수주일자를 기준으로 한다(모든 행이 공유하는 값이므로
    // 첫 행 것을 사용).
    const orderDate = rows.map((r) => str(r.order_date)).find((d) => d != null) ?? null;
    const orderNo = nextSoNo(db, orderDate);
    let lineSeq = 0;

    rows.forEach((r, i) => {
      const customer_code = str(r.customer_code);
      const item_code = str(r.item_code);
      const qty = num(r.qty);

      if (!customer_code || !item_code || !qty || qty <= 0) {
        skipped++;
        errors.push(`${i + 1}행: 거래처/품목코드/수량을 확인해 주세요.`);
        return;
      }
      if (!custCodes.has(customer_code)) {
        skipped++;
        errors.push(`${i + 1}행: 존재하지 않는 거래처(${customer_code})입니다.`);
        return;
      }
      if (!itemCodes.has(item_code)) {
        skipped++;
        errors.push(`${i + 1}행: 존재하지 않는 품목(${item_code})입니다.`);
        return;
      }

      lineSeq++;
      const status = r.status && VALID_STATUS.has(r.status) ? r.status : "수주";
      // 엑셀 업로드분과 동일한 컬럼명으로 저장해 목록 화면(sales-order-columns.ts)이 그대로 표시한다.
      const detail = {
        수주일자: str(r.order_date),
        품목군: str(r.item_group),
        대표품목: str(r.rep_code),
        매출구분: str(r.sales_type),
        화폐: str(r.currency),
        샘플구분: str(r.sample_type),
        환율: num(r.exchange_rate),
        환산금액: num(r.converted_amount),
        "MO-번호": str(r.mo_no),
        비고: str(r.remark),
        수주번호: orderNo,
        순번__2: lineSeq,
      };

      insert.run(
        `${orderNo}-${lineSeq}`,
        customer_code,
        item_code,
        qty,
        num(r.unit_price),
        str(r.due_date),
        status,
        JSON.stringify(detail)
      );
      inserted++;
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ inserted, skipped, errors });
}
