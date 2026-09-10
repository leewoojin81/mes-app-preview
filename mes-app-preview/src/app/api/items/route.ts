import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildItemWhere } from "@/lib/item-filters";
import { numOrNull, strOrNull, strVal, todayDot } from "@/lib/item-fields";

export const runtime = "nodejs";

// 원본 엑셀 순서: 파일 순서(완제품→반제품→원자재), 파일 내에서는 No.(seq_no) 순
const EXCEL_ORDER =
  "ORDER BY CASE category WHEN '완제품' THEN 0 WHEN '반제품' THEN 1 ELSE 2 END, seq_no, item_code";

export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const pageParam = params.get("page");
  const { where, args } = buildItemWhere(params);

  // Pagination is opt-in via ?page=; omitting it preserves the original
  // full-array response shape for existing callers.
  if (pageParam) {
    const page = Math.max(1, parseInt(pageParam, 10) || 1);
    const pageSize = Math.min(
      200,
      Math.max(1, parseInt(params.get("pageSize") ?? "50", 10) || 50)
    );
    const offset = (page - 1) * pageSize;
    const total = (
      db.prepare(`SELECT COUNT(*) as c FROM items ${where}`).get(...args) as {
        c: number;
      }
    ).c;
    const rows = (
      db
        .prepare(
          // 화면 목록은 원본 엑셀 순서 그대로, No.도 원본 값 표시
          `SELECT * FROM items ${where} ${EXCEL_ORDER} LIMIT ? OFFSET ?`
        )
        .all(...args, pageSize, offset) as { detail: string | null }[]
    ).map((r) => ({
      ...r,
      detail: r.detail ? JSON.parse(r.detail) : null,
    }));
    return NextResponse.json({ rows, total, page, pageSize });
  }

  // detail(원본 62컬럼 JSON) 전체는 목록 검색용 호출에는 불필요하므로 제외하되,
  // 수주 대량등록 그리드의 품목군 자동 채움, 작업지시등록의 렌즈 속성(lens_spec)
  // 자동 채움에 필요한 값만 가볍게 함께 내려준다.
  const rawRows = db
    .prepare(
      `SELECT item_code, item_name, category, spec, unit, warehouse, safety_stock,
              json_extract(detail, '$.품목군') as item_group,
              json_extract(detail, '$."DIA(직경)"') as dia,
              json_extract(detail, '$.포장방법') as packing_method,
              json_extract(detail, '$."캡(실링지)"') as cap_sealing,
              json_extract(detail, '$.tone') as tone,
              json_extract(detail, '$."B.C"') as bc,
              json_extract(detail, '$.형명') as model_name,
              json_extract(detail, '$.렌즈구분') as lens_type,
              json_extract(detail, '$.주기') as cycle,
              json_extract(detail, '$.Radius') as radius,
              json_extract(detail, '$."Bom구성"') as bom_yn,
              json_extract(detail, '$.입고창고') as warehouse_in
       FROM items ${where} ${EXCEL_ORDER}`
    )
    .all(...args) as Record<string, string | number | null>[];
  const rows = rawRows.map((r) => ({
    item_code: r.item_code,
    item_name: r.item_name,
    category: r.category,
    spec: r.spec,
    unit: r.unit,
    warehouse: r.warehouse,
    safety_stock: r.safety_stock,
    item_group: r.item_group,
    lens_spec: {
      직경: r.dia,
      포장방법: r.packing_method,
      "캡(실링지)": r.cap_sealing,
      Tone: r.tone,
      형명: r.model_name,
      BC: r.bc,
      렌즈구분: r.lens_type,
      주기: r.cycle,
      Radius: r.radius,
      BOM: r.bom_yn,
      입고창고: r.warehouse_in,
    },
  }));
  return NextResponse.json(rows);
}

const CATEGORIES = ["완제품", "반제품", "원자재"];

// 품목 수동 등록 (화면의 "품목 추가" 폼).
// body: { category, detail } — detail은 원본 엑셀 컬럼명(품목코드/품명/규격/...)을
// 키로 하는 값 모음이며, 품목코드/품명 외 나머지는 전부 선택 입력이다.
export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const category = String(body.category ?? "");
  if (!CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "분류를 선택하세요." }, { status: 400 });
  }
  const rawDetail: Record<string, unknown> =
    body.detail && typeof body.detail === "object" && !Array.isArray(body.detail)
      ? body.detail
      : {};

  const itemCode = strVal(rawDetail["품목코드"]);
  const itemName = strVal(rawDetail["품명"]);
  if (!itemCode) {
    return NextResponse.json({ error: "품목코드는 필수입니다." }, { status: 400 });
  }
  if (!itemName) {
    return NextResponse.json({ error: "품명은 필수입니다." }, { status: 400 });
  }
  if (db.prepare("SELECT 1 FROM items WHERE item_code = ?").get(itemCode)) {
    return NextResponse.json(
      { error: `이미 존재하는 품목코드입니다: ${itemCode}` },
      { status: 409 }
    );
  }

  const spec = strOrNull(rawDetail["규격"]);
  const unit = strOrNull(rawDetail["단위"]) ?? "EA";
  const warehouse = strOrNull(rawDetail["입고창고"]);
  const safetyStock = numOrNull(rawDetail["안전재고"]);
  if (safetyStock === undefined) {
    return NextResponse.json({ error: "안전재고는 숫자여야 합니다." }, { status: 400 });
  }
  const useYn = rawDetail["사용여부"] === "N" ? "N" : "Y";

  // 새 품목은 해당 분류의 원본 순서(No.) 맨 뒤에 붙인다
  const maxSeq = (
    db.prepare("SELECT MAX(seq_no) AS m FROM items WHERE category = ?").get(category) as {
      m: number | null;
    }
  ).m;
  const seqNo = (maxSeq ?? 0) + 1;

  // 사용자가 입력한 나머지 컬럼(품목계정/대분류/.../포장액 등)을 그대로 보존하고,
  // 필수·정형 컬럼만 정규화된 값으로 덮어쓴다.
  const detail: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(rawDetail)) {
    if (v === null || v === undefined) detail[k] = null;
    else if (typeof v === "number") detail[k] = v;
    else detail[k] = strOrNull(v);
  }
  detail["No."] = seqNo;
  detail["품목코드"] = itemCode;
  detail["품명"] = itemName;
  detail["규격"] = spec;
  detail["단위"] = unit;
  detail["입고창고"] = warehouse;
  detail["안전재고"] = safetyStock;
  detail["사용여부"] = useYn;
  detail["품목계정"] = strOrNull(rawDetail["품목계정"]) ?? category;
  detail["등록일자"] = strOrNull(rawDetail["등록일자"]) ?? todayDot();

  db.prepare(
    `INSERT INTO items (item_code, item_name, category, spec, unit, warehouse, safety_stock, seq_no, use_yn, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    itemCode,
    itemName,
    category,
    spec,
    unit,
    warehouse,
    safetyStock,
    seqNo,
    useYn,
    JSON.stringify(detail)
  );
  return NextResponse.json({ ok: true, item_code: itemCode }, { status: 201 });
}
