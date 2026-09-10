import { NextRequest, NextResponse } from "next/server";
import { getDb, nextWoNo } from "@/lib/db";

export const runtime = "nodejs";

interface BulkRowInput {
  so_no?: string | null;
  line_id?: string | null;
  order_qty?: number | string | null;
  due_date?: string | null;
  seq?: string | number | null;
  line_seq?: string | number | null;
  urgent?: boolean | null;
  release_use?: boolean | null;
  request_no?: string | null;
  remark?: string | null;
}

function str(v: string | number | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/,/g, "").trim()) : v;
  return Number.isFinite(n) ? n : null;
}

interface ItemDetailRow {
  category: string;
  detail: string | null;
}
interface SalesOrderRow {
  item_code: string;
  due_date: string | null;
  detail: string | null;
}

// 작업지시등록(PROD-03) 화면 전용 — 확정 수주를 선택해 한 번에 여러 작업지시를 생성한다.
// 품목 마스터의 렌즈 속성(직경/포장방법/캡실링지/Tone/형명/BC/렌즈구분/주기/Radius/BOM/
// 입고창고)을 생성 시점 스냅샷으로 detail JSON에 저장해, 이후 품목 정보가 바뀌어도
// 실제 작업지시에 쓰인 사양은 그대로 보존한다.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const rows = (body as { rows?: BulkRowInput[] } | null)?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "생성할 작업지시가 없습니다." }, { status: 400 });
  }

  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO work_orders (wo_no, item_code, line_id, order_qty, produced_qty, status, due_date, so_no, detail)
     VALUES (?, ?, ?, ?, 0, '대기', ?, ?, ?)`
  );

  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];
  const createdWoNos: string[] = [];

  db.exec("BEGIN");
  try {
    rows.forEach((r, i) => {
      const so_no = str(r.so_no);
      const line_id = str(r.line_id);
      const order_qty = num(r.order_qty);

      if (!so_no || !line_id || !order_qty || order_qty <= 0) {
        skipped++;
        errors.push(`${i + 1}행: 수주번호/라인/지시수량을 확인해 주세요.`);
        return;
      }
      const so = db
        .prepare("SELECT item_code, due_date, detail FROM sales_orders WHERE so_no = ?")
        .get(so_no) as SalesOrderRow | undefined;
      if (!so) {
        skipped++;
        errors.push(`${i + 1}행: 존재하지 않는 수주(${so_no})입니다.`);
        return;
      }
      const item = db
        .prepare("SELECT category, detail FROM items WHERE item_code = ?")
        .get(so.item_code) as ItemDetailRow | undefined;
      if (!item) {
        skipped++;
        errors.push(`${i + 1}행: 존재하지 않는 품목(${so.item_code})입니다.`);
        return;
      }
      if (item.category !== "완제품") {
        skipped++;
        errors.push(`${i + 1}행: 완제품만 작업지시 대상으로 등록할 수 있습니다.`);
        return;
      }

      const itemDetail = item.detail
        ? (JSON.parse(item.detail) as Record<string, string | number | null>)
        : {};
      const soDetail = so.detail
        ? (JSON.parse(so.detail) as Record<string, string | number | null>)
        : {};

      const detail = {
        품목군: itemDetail["품목군"] ?? null,
        직경: itemDetail["DIA(직경)"] ?? null,
        포장방법: itemDetail["포장방법"] ?? null,
        "캡(실링지)": itemDetail["캡(실링지)"] ?? null,
        Tone: itemDetail["tone"] ?? null,
        형명: itemDetail["형명"] ?? null,
        BC: itemDetail["B.C"] ?? null,
        렌즈구분: itemDetail["렌즈구분"] ?? null,
        주기: itemDetail["주기"] ?? null,
        Radius: itemDetail["Radius"] ?? null,
        BOM: itemDetail["Bom구성"] ?? null,
        입고창고: itemDetail["입고창고"] ?? null,
        순서: str(r.seq),
        순번: str(r.line_seq) ?? soDetail["순번"] ?? soDetail["순번__2"] ?? null,
        긴급: r.urgent ? "Y" : "N",
        "Release사용": r.release_use ? "Y" : "N",
        의뢰번호: str(r.request_no),
        비고: str(r.remark),
      };

      const wo_no = nextWoNo(db);
      insert.run(
        wo_no,
        so.item_code,
        line_id,
        order_qty,
        str(r.due_date) ?? so.due_date,
        so_no,
        JSON.stringify(detail)
      );
      createdWoNos.push(wo_no);
      inserted++;
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ inserted, skipped, errors, wo_nos: createdWoNos });
}
