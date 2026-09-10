import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

const CATEGORIES = ["완제품", "반제품", "원자재"];

// 엑셀의 "품목계정" 값을 화면 분류(category)로 매핑. 부자재/원자재는 모두
// category="원자재"로 합쳐진다 (자재등록 화면의 실제 데이터 관례).
function mapAcctToCategory(raw: string): string | null {
  const v = raw.trim();
  if (v === "완제품") return "완제품";
  if (v === "반제품") return "반제품";
  if (v === "부자재" || v === "원자재") return "원자재";
  return null;
}

// 엑셀 업로드 임포트: 기준정보 원본 양식(품목코드/품명/규격/단위/입고창고/안전재고/사용여부/No./품목계정)을
// 파싱해 upsert 한다. scripts/import-items.js 와 같은 규칙.
//
// 분류는 더 이상 팝업에서 고르지 않는다 — 업로드 대상 화면이 다루는 분류
// 범위(cats)만 받고, 실제 각 행의 분류는 엑셀의 "품목계정" 컬럼에서 읽는다.
// 화면이 분류를 하나만 다룰 때(자재등록=원자재)는 그 값으로 고정한다.
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const allowedCategories = String(form?.get("cats") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c) => CATEGORIES.includes(c));
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "업로드할 파일이 없습니다." }, { status: 400 });
  }
  if (allowedCategories.length === 0) {
    return NextResponse.json({ error: "분류 범위가 올바르지 않습니다." }, { status: 400 });
  }
  const fixedCategory = allowedCategories.length === 1 ? allowedCategories[0] : null;

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(Buffer.from(await file.arrayBuffer()));
  } catch {
    return NextResponse.json(
      { error: "엑셀 파일을 읽을 수 없습니다. (.xlsx/.xls 파일인지 확인하세요)" },
      { status: 400 }
    );
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as (
    | string
    | number
    | null
  )[][];
  const header = (rows[0] ?? []).map((h) => (h == null ? "" : String(h).trim()));
  const idx = (name: string) => header.indexOf(name);
  const iCode = idx("품목코드");
  if (iCode === -1) {
    return NextResponse.json(
      { error: '첫 시트의 1행에서 "품목코드" 컬럼을 찾을 수 없습니다.' },
      { status: 400 }
    );
  }
  const iAcct = idx("품목계정");
  if (!fixedCategory && iAcct === -1) {
    return NextResponse.json(
      {
        error:
          '이 화면은 여러 분류를 다룹니다. 엑셀에 "품목계정" 컬럼이 있어야 행마다 분류를 자동으로 구분할 수 있습니다.',
      },
      { status: 400 }
    );
  }
  const iName = idx("품명");
  const iSpec = idx("규격");
  const iUnit = idx("단위");
  const iWh = idx("입고창고");
  const iSafety = idx("안전재고");
  const iNo = idx("No.");
  const iUse = idx("사용여부");

  const db = getDb();
  const exists = db.prepare("SELECT seq_no FROM items WHERE item_code = ?");
  const upsert = db.prepare(
    `INSERT INTO items (item_code, item_name, category, spec, unit, warehouse, safety_stock, seq_no, use_yn, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_code) DO UPDATE SET
       item_name = excluded.item_name,
       category = excluded.category,
       spec = excluded.spec,
       unit = excluded.unit,
       warehouse = excluded.warehouse,
       safety_stock = excluded.safety_stock,
       seq_no = excluded.seq_no,
       use_yn = excluded.use_yn,
       detail = excluded.detail`
  );

  // 분류별 다음 seq_no(No.) 채번 카운터 — 필요해질 때 DB에서 조회해 초기화
  const nextSeqByCategory = new Map<string, number>();
  const nextSeq = (cat: string): number => {
    if (!nextSeqByCategory.has(cat)) {
      const maxSeq = db.prepare("SELECT MAX(seq_no) AS m FROM items WHERE category = ?").get(cat) as {
        m: number | null;
      };
      nextSeqByCategory.set(cat, (maxSeq.m ?? 0) + 1);
    }
    const seq = nextSeqByCategory.get(cat) as number;
    nextSeqByCategory.set(cat, seq + 1);
    return seq;
  };

  // 파일의 No. 순서대로 정렬해 처리한다 (No. 없는 행은 시트 순서 그대로 뒤에)
  let skippedNoCode = 0;
  let skippedCategory = 0;
  const parsed: {
    code: string;
    category: string;
    fileNo: number | null;
    detail: Record<string, string | number | null>;
    raw: (string | number | null)[];
  }[] = [];
  for (const r of rows.slice(1)) {
    const code = r[iCode] == null ? "" : String(r[iCode]).trim();
    if (!code) {
      skippedNoCode++;
      continue;
    }
    const category =
      fixedCategory ?? mapAcctToCategory(r[iAcct] == null ? "" : String(r[iAcct]));
    if (!category || !allowedCategories.includes(category)) {
      skippedCategory++;
      continue;
    }
    const detail: Record<string, string | number | null> = {};
    header.forEach((name, i) => {
      if (!name) return;
      detail[name] = r[i] == null ? null : r[i];
    });
    parsed.push({
      code,
      category,
      fileNo: iNo !== -1 && typeof r[iNo] === "number" ? (r[iNo] as number) : null,
      detail,
      raw: r,
    });
  }
  parsed.sort((a, b) => (a.fileNo ?? Infinity) - (b.fileNo ?? Infinity));

  let inserted = 0;
  let updated = 0;
  db.exec("BEGIN");
  try {
    for (const { code, category, fileNo, detail, raw: r } of parsed) {
      // 기존 품목은 원래 목록 위치(No.)를 유지하고, 신규 품목은 파일의 No. 순서를
      // 유지한 채 해당 분류 목록 맨 뒤에 이어붙인다. 화면의 No. 표시(detail)도
      // 정렬 기준(seq_no)과 항상 일치시킨다.
      const existing = exists.get(code) as { seq_no: number | null } | undefined;
      const seqNo = fileNo ?? existing?.seq_no ?? nextSeq(category);
      detail["No."] = seqNo;
      const useYn =
        iUse !== -1 && String(r[iUse] ?? "").trim() === "N" ? "N" : "Y";
      if (detail["사용여부"] == null) detail["사용여부"] = useYn;

      upsert.run(
        code,
        iName !== -1 && r[iName] != null ? String(r[iName]).trim() : code,
        category,
        iSpec !== -1 && r[iSpec] != null ? String(r[iSpec]).trim() : null,
        iUnit !== -1 && r[iUnit] != null ? String(r[iUnit]).trim() : "EA",
        iWh !== -1 && r[iWh] != null ? String(r[iWh]).trim() : null,
        iSafety !== -1 && typeof r[iSafety] === "number" ? (r[iSafety] as number) : null,
        seqNo,
        useYn,
        JSON.stringify(detail)
      );
      if (existing) updated++;
      else inserted++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ inserted, updated, skippedNoCode, skippedCategory });
}
