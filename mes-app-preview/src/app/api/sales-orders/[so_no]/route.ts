import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

type Params = { params: Promise<{ so_no: string }> };

const VALID_STATUS = new Set(["수주", "Packing", "출고", "완료", "중단"]);

function str(v: string | null | undefined): string | null {
  const s = (v ?? "").toString().trim();
  return s === "" ? null : s;
}
function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/,/g, "").trim()) : v;
  return Number.isFinite(n) ? n : null;
}

interface UpdateBody {
  action: "update";
  customer_code?: string | null;
  item_code?: string | null;
  order_qty?: number | string | null;
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

export async function PATCH(req: NextRequest, { params }: Params) {
  const { so_no } = await params;
  const body = await req.json();
  const action = (body as { action?: string }).action;

  const db = getDb();
  const so = db
    .prepare("SELECT * FROM sales_orders WHERE so_no = ?")
    .get(so_no) as { status: string; detail: string | null } | undefined;

  if (!so) {
    return NextResponse.json({ error: "수주를 찾을 수 없습니다." }, { status: 404 });
  }

  if (action === "plan") {
    // 생산순위지정(PLAN-01) 화면 전용 — 작업순서/계획제외 두 값만 detail에 반영한다.
    const b = body as { priority?: number | string | null; exclude?: boolean | null };
    const priority = b.priority == null || b.priority === "" ? null : Number(b.priority);
    if (priority != null && !Number.isFinite(priority)) {
      return NextResponse.json({ error: "작업순서는 숫자로 입력해 주세요." }, { status: 400 });
    }
    const existingDetail = so.detail
      ? (JSON.parse(so.detail) as Record<string, string | number | null>)
      : {};
    const detail = { ...existingDetail, 작업순서: priority, 계획제외: b.exclude ? "Y" : "N" };
    db.prepare("UPDATE sales_orders SET detail = ? WHERE so_no = ?").run(
      JSON.stringify(detail),
      so_no
    );
  } else if (action === "cancel") {
    // 수주등록(SALES-02) 처리 컬럼 전용 마감 처리 — "수주" 상태인 건만 "중단"으로 바꿀 수 있다.
    // Packing/출고/완료 전환은 이 화면이 아니라 PackList/제품출고등록에서 다룬다.
    const existingDetail = so.detail
      ? (JSON.parse(so.detail) as Record<string, string | number | null>)
      : {};
    const effective = String(existingDetail["상태"] ?? so.status);
    if (effective !== "수주") {
      return NextResponse.json(
        { error: "'수주' 상태인 건만 중단 처리할 수 있습니다." },
        { status: 400 }
      );
    }
    const detail = { ...existingDetail, 상태: "중단" };
    db.prepare("UPDATE sales_orders SET status = '중단', detail = ? WHERE so_no = ?").run(
      JSON.stringify(detail),
      so_no
    );
  } else if (action === "update") {
    const b = body as UpdateBody;
    const customer_code = str(b.customer_code);
    const item_code = str(b.item_code);
    const order_qty = b.order_qty != null ? Number(b.order_qty) : null;

    if (!customer_code || !item_code || !order_qty || order_qty <= 0) {
      return NextResponse.json(
        { error: "거래처, 품목, 수량을 확인해 주세요." },
        { status: 400 }
      );
    }
    const customer = db
      .prepare("SELECT 1 FROM customers WHERE customer_code = ?")
      .get(customer_code);
    if (!customer) {
      return NextResponse.json({ error: "존재하지 않는 거래처입니다." }, { status: 400 });
    }
    const item = db.prepare("SELECT 1 FROM items WHERE item_code = ?").get(item_code);
    if (!item) {
      return NextResponse.json({ error: "존재하지 않는 품목입니다." }, { status: 400 });
    }

    // 기존 detail의 다른 값(원본 엑셀 컬럼 등)은 보존하고, 수정 폼에서 다루는 항목만 덮어쓴다.
    const existingDetail = so.detail
      ? (JSON.parse(so.detail) as Record<string, string | number | null>)
      : {};
    // 화면에 실제 표시되는 값(detail.상태 우선)을 기준으로 대체값을 정한다 — status 컬럼은
    // 엑셀 업로드분 한정으로 예전 임포트 매핑이 남아 있어 신뢰할 수 없다.
    const currentEffective = String(existingDetail["상태"] ?? so.status);
    const status = b.status && VALID_STATUS.has(b.status) ? b.status : currentEffective;

    const detail = {
      ...existingDetail,
      // detail.상태를 이미 쓰고 있던 건(엑셀 업로드분, 중단 처리한 건 등)만 함께 갱신한다 —
      // 그 외 수동/일괄등록분은 그대로 status 컬럼만으로 상태를 관리한다.
      ...("상태" in existingDetail ? { 상태: status } : {}),
      수주일자: str(b.order_date),
      매출구분: str(b.sales_type),
      화폐: str(b.currency),
      샘플구분: str(b.sample_type),
      "MO-번호": str(b.mo_no),
      비고: str(b.remark),
      환율: num(b.exchange_rate),
      환산금액: num(b.converted_amount),
    };

    db.prepare(
      `UPDATE sales_orders
       SET customer_code = ?, item_code = ?, order_qty = ?, unit_price = ?, due_date = ?, status = ?, detail = ?
       WHERE so_no = ?`
    ).run(
      customer_code,
      item_code,
      order_qty,
      b.unit_price != null && b.unit_price !== "" ? Number(b.unit_price) : null,
      str(b.due_date),
      status,
      JSON.stringify(detail),
      so_no
    );
  } else {
    return NextResponse.json({ error: "지원하지 않는 action 입니다." }, { status: 400 });
  }

  const updated = db
    .prepare(
      `SELECT so.*, c.customer_name as customer_name, it.item_name as item_name
       FROM sales_orders so
       JOIN customers c ON c.customer_code = so.customer_code
       JOIN items it ON it.item_code = so.item_code
       WHERE so.so_no = ?`
    )
    .get(so_no) as { detail: string | null } | undefined;

  return NextResponse.json(
    updated && { ...updated, detail: updated.detail ? JSON.parse(updated.detail) : null }
  );
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { so_no } = await params;
  const db = getDb();
  const so = db.prepare("SELECT so_no FROM sales_orders WHERE so_no = ?").get(so_no);
  if (!so) {
    return NextResponse.json({ error: "수주를 찾을 수 없습니다." }, { status: 404 });
  }
  db.prepare("DELETE FROM sales_orders WHERE so_no = ?").run(so_no);
  return NextResponse.json({ ok: true });
}
