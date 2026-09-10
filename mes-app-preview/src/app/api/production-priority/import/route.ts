import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

function str(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// 엑셀 다운로드로 받은 양식을 그대로 다시 올리는 왕복 업로드 — "수주번호"+"순번"으로
// so_no(수주번호-순번 형식, sales-orders/import/route.ts 와 동일한 규칙)를 복원해 수주를
// 찾고, "작업순서"·"계획제외" 두 값만 detail에 반영한다(다른 컬럼은 참고용이라 무시).
// 순번이 없는(수동 등록) 수주는 수주번호 자체가 so_no이므로 그대로도 매칭한다.
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "업로드할 파일이 없습니다." }, { status: 400 });
  }

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
  const iOrderNo = header.indexOf("수주번호");
  const iLineSeq = header.indexOf("순번");
  const iPriority = header.indexOf("작업순서");
  const iExclude = header.indexOf("계획제외");

  if (iOrderNo === -1 || iPriority === -1) {
    return NextResponse.json(
      { error: `1행에서 다음 컬럼을 찾을 수 없습니다: 수주번호, 작업순서` },
      { status: 400 }
    );
  }

  const db = getDb();
  const existing = db.prepare("SELECT so_no, detail FROM sales_orders").all() as {
    so_no: string;
    detail: string | null;
  }[];
  const bySoNo = new Map(existing.map((r) => [r.so_no, r.detail]));

  const update = db.prepare("UPDATE sales_orders SET detail = ? WHERE so_no = ?");

  let updated = 0;
  let skippedNotFound = 0;
  let skippedInvalid = 0;

  db.exec("BEGIN");
  try {
    for (const r of rows.slice(1)) {
      const orderNo = str(r[iOrderNo]);
      if (!orderNo) {
        skippedInvalid++;
        continue;
      }
      const lineSeq = iLineSeq !== -1 ? str(r[iLineSeq]) : null;
      const soNo = lineSeq && bySoNo.has(`${orderNo}-${lineSeq}`) ? `${orderNo}-${lineSeq}` : orderNo;
      if (!bySoNo.has(soNo)) {
        skippedNotFound++;
        continue;
      }

      const priorityRaw = r[iPriority];
      const priority = priorityRaw == null || priorityRaw === "" ? null : Number(priorityRaw);
      if (priority != null && !Number.isFinite(priority)) {
        skippedInvalid++;
        continue;
      }
      const excludeRaw = iExclude !== -1 ? str(r[iExclude]) : null;
      const exclude = excludeRaw === "Y" ? "Y" : "N";

      const existingDetail = bySoNo.get(soNo);
      const detail = existingDetail
        ? (JSON.parse(existingDetail) as Record<string, string | number | null>)
        : {};
      detail["작업순서"] = priority;
      detail["계획제외"] = exclude;
      update.run(JSON.stringify(detail), soNo);
      updated++;
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ updated, skippedNotFound, skippedInvalid });
}
