import { NextRequest, NextResponse } from "next/server";
import { getDb, nextWoNo } from "@/lib/db";

export const runtime = "nodejs";

// 작업지시등록(PROD-03) 목록 화면이 필요로 하는 수주번호/거래처명/Lot No까지 함께
// 내려준다. 기존 작업지시발행(PROD-01)/POP 화면은 이 응답의 배열 형태와 기존
// 필드만 사용하므로 하위 호환된다.
const SELECT_JOINED = `
  SELECT wo.*, it.item_name as item_name, so.customer_code as so_customer_code,
         c.customer_name as customer_name,
         (SELECT GROUP_CONCAT(l.lot_no) FROM lots l WHERE l.wo_no = wo.wo_no) as lot_no
  FROM work_orders wo
  JOIN items it ON it.item_code = wo.item_code
  LEFT JOIN sales_orders so ON so.so_no = wo.so_no
  LEFT JOIN customers c ON c.customer_code = so.customer_code
`;

function parseDetail<T extends { detail?: string | null }>(r: T) {
  return { ...r, detail: r.detail ? JSON.parse(r.detail) : null };
}

export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const statusParam = params.get("status");
  const woNoParam = params.get("woNo");
  const soNoParam = params.get("soNo");
  const customerParam = params.get("customer");

  const conditions: string[] = [];
  const args: string[] = [];
  if (statusParam) {
    const statuses = statusParam.split(",").map((s) => s.trim());
    conditions.push(`wo.status IN (${statuses.map(() => "?").join(",")})`);
    args.push(...statuses);
  }
  if (woNoParam) {
    conditions.push("wo.wo_no LIKE ?");
    args.push(`%${woNoParam}%`);
  }
  if (soNoParam) {
    conditions.push("wo.so_no LIKE ?");
    args.push(`%${soNoParam}%`);
  }
  if (customerParam) {
    conditions.push("(so.customer_code LIKE ? OR c.customer_name LIKE ?)");
    args.push(`%${customerParam}%`, `%${customerParam}%`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = (
    db
      .prepare(`${SELECT_JOINED} ${where} ORDER BY wo.created_at DESC`)
      .all(...args) as { detail: string | null }[]
  ).map(parseDetail);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { item_code, line_id, order_qty, due_date } = body as {
    item_code?: string;
    line_id?: string;
    order_qty?: number;
    due_date?: string | null;
  };

  if (!item_code || !line_id || !order_qty || order_qty <= 0) {
    return NextResponse.json(
      { error: "품목, 라인, 지시수량을 확인해 주세요." },
      { status: 400 }
    );
  }

  const db = getDb();
  const item = db
    .prepare("SELECT * FROM items WHERE item_code = ?")
    .get(item_code) as { category: string } | undefined;
  if (!item) {
    return NextResponse.json({ error: "존재하지 않는 품목입니다." }, { status: 400 });
  }
  if (item.category !== "완제품") {
    return NextResponse.json(
      { error: "완제품만 작업지시 대상으로 등록할 수 있습니다." },
      { status: 400 }
    );
  }

  const wo_no = nextWoNo(db);
  db.prepare(
    `INSERT INTO work_orders (wo_no, item_code, line_id, order_qty, produced_qty, status, due_date)
     VALUES (?, ?, ?, ?, 0, '대기', ?)`
  ).run(wo_no, item_code, line_id, order_qty, due_date ?? null);

  const created = db
    .prepare(
      `SELECT wo.*, it.item_name as item_name
       FROM work_orders wo JOIN items it ON it.item_code = wo.item_code
       WHERE wo.wo_no = ?`
    )
    .get(wo_no);

  return NextResponse.json(created, { status: 201 });
}
