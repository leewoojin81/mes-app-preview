import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const VALID_STATUS = new Set(["수주", "Packing", "출고", "완료", "중단"]);

interface BulkUpdateRowInput {
  so_no: string;
  customer_code?: string | null;
  item_code?: string | null;
  qty?: number | string | null;
  unit_price?: number | string | null;
  due_date?: string | null;
  status?: string | null;
  order_date?: string | null;
  sales_type?: string | null;
  currency?: string | null;
  sample_type?: string | null;
  mo_no?: string | null;
  remark?: string | null;
  exchange_rate?: number | string | null;
  converted_amount?: number | string | null;
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

// 목록 화면에서 선택한 기존 수주 여러 건을 그리드에서 한 번에 수정한다.
// 단건 수정(PATCH /api/sales-orders/[so_no] action=update)과 같은 규칙으로
// detail JSON은 기존 값(원본 엑셀 컬럼 등)을 보존하고 폼에서 다루는 항목만 덮어쓴다.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rows = (body as { rows?: BulkUpdateRowInput[] } | null)?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "수정할 행이 없습니다." }, { status: 400 });
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
  const existing = db.prepare("SELECT so_no, status, detail FROM sales_orders WHERE so_no = ?");
  const update = db.prepare(
    `UPDATE sales_orders
     SET customer_code = ?, item_code = ?, order_qty = ?, unit_price = ?, due_date = ?, status = ?, detail = ?
     WHERE so_no = ?`
  );

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  db.exec("BEGIN");
  try {
    rows.forEach((r, i) => {
      const so_no = str(r.so_no);
      const customer_code = str(r.customer_code);
      const item_code = str(r.item_code);
      const qty = num(r.qty);

      if (!so_no || !customer_code || !item_code || !qty || qty <= 0) {
        skipped++;
        errors.push(`${i + 1}행: 거래처/품목코드/수량을 확인해 주세요.`);
        return;
      }
      const row = existing.get(so_no) as
        | { so_no: string; status: string; detail: string | null }
        | undefined;
      if (!row) {
        skipped++;
        errors.push(`${i + 1}행: 수주(${so_no})를 찾을 수 없습니다.`);
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

      const existingDetail = row.detail
        ? (JSON.parse(row.detail) as Record<string, string | number | null>)
        : {};
      // 화면에 실제 표시되는 값(detail.상태 우선)을 기준으로 대체값을 정한다 — status 컬럼은
      // 엑셀 업로드분 한정으로 예전 임포트 매핑이 남아 있어 신뢰할 수 없다.
      const currentEffective = String(existingDetail["상태"] ?? row.status);
      const status = r.status && VALID_STATUS.has(r.status) ? r.status : currentEffective;
      const detail = {
        ...existingDetail,
        // detail.상태를 이미 쓰고 있던 건만 함께 갱신한다 — 나머지는 status 컬럼만으로 관리한다.
        ...("상태" in existingDetail ? { 상태: status } : {}),
        수주일자: str(r.order_date),
        매출구분: str(r.sales_type),
        화폐: str(r.currency),
        샘플구분: str(r.sample_type),
        "MO-번호": str(r.mo_no),
        비고: str(r.remark),
        환율: num(r.exchange_rate),
        환산금액: num(r.converted_amount),
      };

      update.run(
        customer_code,
        item_code,
        qty,
        num(r.unit_price),
        str(r.due_date),
        status,
        JSON.stringify(detail),
        so_no
      );
      updated++;
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ updated, skipped, errors });
}
