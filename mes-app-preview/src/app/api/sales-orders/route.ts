import { NextRequest, NextResponse } from "next/server";
import { getDb, nextSoNo } from "@/lib/db";
import { SALES_ORDER_SUM_KEYS } from "@/lib/sales-order-columns";

export const runtime = "nodejs";

// 목록 화면(sales-order-columns.ts의 salesOrderFallbackCell)이 표시하는 값과 같은 기준으로
// 합계를 낸다 — 엑셀 업로드분은 detail JSON 값을, 수동 등록분은 실제 컬럼(order_qty/unit_price)을 쓴다.
const SUM_EXPR: Record<(typeof SALES_ORDER_SUM_KEYS)[number], string> = {
  수량: `COALESCE(json_extract(so.detail, '$.수량'), so.order_qty)`,
  금액: `COALESCE(json_extract(so.detail, '$.금액'), CASE WHEN so.unit_price IS NOT NULL THEN so.order_qty * so.unit_price ELSE NULL END)`,
  환산금액: `json_extract(so.detail, '$.환산금액')`,
};

const SELECT_JOINED = `SELECT so.*, c.customer_name as customer_name, it.item_name as item_name
       FROM sales_orders so
       JOIN customers c ON c.customer_code = so.customer_code
       JOIN items it ON it.item_code = so.item_code`;

// 수주일자 = 원본 엑셀의 "수주일자"(YYYY.MM.DD → YYYY-MM-DD). 수동 등록분(detail 없음)은
// 별도 수주일자가 없어 등록일(created_at)의 날짜 부분으로 대체한다.
const ORDER_DATE_EXPR = `COALESCE(NULLIF(replace(json_extract(so.detail, '$.수주일자'), '.', '-'), ''), substr(so.created_at, 1, 10))`;

// 상태 필터/표시 기준 = 목록 화면에 실제 보이는 값과 동일하게 원본 엑셀 "상태"(수주/Packing/
// 완료/중단)를 우선하고, detail이 없는 수동 등록분만 내부 워크플로 상태(대기/확정/완료)로 대체한다.
const STATUS_EXPR = `COALESCE(json_extract(so.detail, '$.상태'), so.status)`;

function parseDetail<T extends { detail?: string | null }>(r: T) {
  return { ...r, detail: r.detail ? JSON.parse(r.detail) : null };
}

export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const statusParam = params.get("status");
  const pageParam = params.get("page");
  const customerParam = params.get("customer");
  const soNoParam = params.get("soNo");
  const dateFromParam = params.get("dateFrom");
  const dateToParam = params.get("dateTo");

  const conditions: string[] = [];
  const args: string[] = [];
  if (statusParam) {
    const statuses = statusParam.split(",").map((s) => s.trim());
    conditions.push(`${STATUS_EXPR} IN (${statuses.map(() => "?").join(",")})`);
    args.push(...statuses);
  }
  if (customerParam) {
    conditions.push("(so.customer_code LIKE ? OR c.customer_name LIKE ?)");
    args.push(`%${customerParam}%`, `%${customerParam}%`);
  }
  if (soNoParam) {
    conditions.push("so.so_no LIKE ?");
    args.push(`%${soNoParam}%`);
  }
  if (dateFromParam) {
    conditions.push(`${ORDER_DATE_EXPR} >= ?`);
    args.push(dateFromParam);
  }
  if (dateToParam) {
    conditions.push(`${ORDER_DATE_EXPR} <= ?`);
    args.push(dateToParam);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // 페이지네이션은 ?page= 로 옵트인 — 생략 시 기존 전체 배열 응답 형태를 유지한다.
  if (pageParam) {
    const page = Math.max(1, parseInt(pageParam, 10) || 1);
    const pageSize = Math.min(
      200,
      Math.max(1, parseInt(params.get("pageSize") ?? "50", 10) || 50)
    );
    const offset = (page - 1) * pageSize;
    const total = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM sales_orders so JOIN customers c ON c.customer_code = so.customer_code ${where}`
        )
        .get(...args) as { c: number }
    ).c;
    const rows = (
      db
        .prepare(
          `${SELECT_JOINED} ${where} ORDER BY so.created_at DESC, so.so_no DESC LIMIT ? OFFSET ?`
        )
        .all(...args, pageSize, offset) as { detail: string | null }[]
    ).map(parseDetail);

    // 하단 합계 행 — 현재 페이지가 아니라 검색/필터 조건이 적용된 전체 건 기준으로 계산한다.
    const sumSelect = SALES_ORDER_SUM_KEYS.map(
      (key) => `SUM(${SUM_EXPR[key]}) as "${key}"`
    ).join(", ");
    const totalsRow = db
      .prepare(
        `SELECT ${sumSelect} FROM sales_orders so JOIN customers c ON c.customer_code = so.customer_code ${where}`
      )
      .get(...args) as Record<string, number | null>;
    const totals = Object.fromEntries(
      SALES_ORDER_SUM_KEYS.map((key) => [key, totalsRow[key] ?? 0])
    );

    return NextResponse.json({ rows, total, page, pageSize, totals });
  }

  const rows = (
    db.prepare(`${SELECT_JOINED} ${where} ORDER BY so.created_at DESC`).all(...args) as {
      detail: string | null;
    }[]
  ).map(parseDetail);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    customer_code,
    item_code,
    order_qty,
    unit_price,
    due_date,
    mo_no,
    line_seq,
    sample_type,
    price_type,
    remark,
  } = body as {
    customer_code?: string;
    item_code?: string;
    order_qty?: number;
    unit_price?: number | null;
    due_date?: string | null;
    mo_no?: string | null;
    line_seq?: string | null;
    sample_type?: string | null;
    price_type?: string | null;
    remark?: string | null;
  };

  if (!customer_code || !item_code || !order_qty || order_qty <= 0) {
    return NextResponse.json(
      { error: "거래처, 품목, 수주수량을 확인해 주세요." },
      { status: 400 }
    );
  }

  const db = getDb();
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

  // 엑셀 업로드분과 동일한 컬럼명으로 저장해 목록 화면(sales-order-columns.ts)이
  // 그대로 표시할 수 있게 한다. "단가구분"은 원본 엑셀에는 없는 수동 등록 전용 항목.
  const detail = {
    "MO-번호": mo_no?.trim() || null,
    순번: line_seq?.trim() || null,
    샘플구분: sample_type?.trim() || null,
    단가구분: price_type?.trim() || null,
    비고: remark?.trim() || null,
  };

  const so_no = nextSoNo(db);
  db.prepare(
    `INSERT INTO sales_orders (so_no, customer_code, item_code, order_qty, unit_price, due_date, status, detail)
     VALUES (?, ?, ?, ?, ?, ?, '수주', ?)`
  ).run(
    so_no,
    customer_code,
    item_code,
    order_qty,
    unit_price ?? null,
    due_date ?? null,
    JSON.stringify(detail)
  );

  const created = db.prepare(`${SELECT_JOINED} WHERE so.so_no = ?`).get(so_no);
  return NextResponse.json(created, { status: 201 });
}
