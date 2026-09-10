import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { numOrNull, strOrNull, strVal, todayDot } from "@/lib/item-fields";

export const runtime = "nodejs";

const CATEGORIES = ["완제품", "반제품", "원자재"];
// 도수 접미사: 4자리 숫자 문자열만 허용 (예: "0000", "0125")
const DIOPTER_RE = /^\d{4}$/;

// 대표코드 + 도수 목록으로 "대표코드"와 "대표코드-도수" 품목들을 한 번에 생성한다.
// body: { category, detail: {품목코드=대표코드, 품명, ...}, diopters: string[] }
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

  const baseCode = strVal(rawDetail["품목코드"]);
  const itemName = strVal(rawDetail["품명"]);
  if (!baseCode) {
    return NextResponse.json({ error: "대표코드는 필수입니다." }, { status: 400 });
  }
  if (!itemName) {
    return NextResponse.json({ error: "품명은 필수입니다." }, { status: 400 });
  }

  const diopters: unknown = body.diopters;
  if (!Array.isArray(diopters) || diopters.length === 0) {
    return NextResponse.json({ error: "도수를 1개 이상 선택하세요." }, { status: 400 });
  }
  const suffixes: string[] = [];
  for (const d of diopters) {
    const s = strVal(d);
    if (!DIOPTER_RE.test(s)) {
      return NextResponse.json(
        { error: `도수 값이 올바르지 않습니다: ${String(d)}` },
        { status: 400 }
      );
    }
    if (!suffixes.includes(s)) suffixes.push(s);
  }
  suffixes.sort((a, b) => Number(a) - Number(b));

  const codes = [baseCode, ...suffixes.map((s) => `${baseCode}-${s}`)];
  const existing = db
    .prepare(
      `SELECT item_code FROM items WHERE item_code IN (${codes.map(() => "?").join(",")})`
    )
    .all(...codes) as { item_code: string }[];
  if (existing.length) {
    return NextResponse.json(
      {
        error: `이미 존재하는 품목코드입니다: ${existing.map((r) => r.item_code).join(", ")}`,
      },
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
  const acct = strOrNull(rawDetail["품목계정"]) ?? category;
  const regDate = strOrNull(rawDetail["등록일자"]) ?? todayDot();

  const baseDetailCommon: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(rawDetail)) {
    if (v === null || v === undefined) baseDetailCommon[k] = null;
    else if (typeof v === "number") baseDetailCommon[k] = v;
    else baseDetailCommon[k] = strOrNull(v);
  }
  baseDetailCommon["품명"] = itemName;
  baseDetailCommon["규격"] = spec;
  baseDetailCommon["단위"] = unit;
  baseDetailCommon["입고창고"] = warehouse;
  baseDetailCommon["안전재고"] = safetyStock;
  baseDetailCommon["사용여부"] = useYn;
  baseDetailCommon["품목계정"] = acct;
  baseDetailCommon["등록일자"] = regDate;

  // 대표코드 + 도수별 품목을 같은 블록으로 이어붙여 seq_no(No.)를 연속 배정한다
  // (원본 데이터도 대표코드 뒤에 도수 품목들이 바로 이어지는 방식).
  const maxSeq = (
    db.prepare("SELECT MAX(seq_no) AS m FROM items WHERE category = ?").get(category) as {
      m: number | null;
    }
  ).m;
  let seqNo = (maxSeq ?? 0) + 1;

  const insert = db.prepare(
    `INSERT INTO items (item_code, item_name, category, spec, unit, warehouse, safety_stock, seq_no, use_yn, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const created: string[] = [];
  db.exec("BEGIN");
  try {
    const baseDetail = { ...baseDetailCommon, "No.": seqNo, 품목코드: baseCode };
    insert.run(
      baseCode,
      itemName,
      category,
      spec,
      unit,
      warehouse,
      safetyStock,
      seqNo,
      useYn,
      JSON.stringify(baseDetail)
    );
    created.push(baseCode);
    seqNo++;

    for (const suffix of suffixes) {
      const code = `${baseCode}-${suffix}`;
      const detail = { ...baseDetailCommon, "No.": seqNo, 품목코드: code };
      insert.run(
        code,
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
      created.push(code);
      seqNo++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ ok: true, created }, { status: 201 });
}
