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
  const header = (rows[0] ?? []).map((h) => (h == null ? "" : String(h).replace(/[▲▼]/g, "").trim()));
  const iOrderNo = header.indexOf("수주번호");
  const iLineSeq = header.indexOf("순번");
  const iPriority = header.indexOf("작업순서");
  const iExclude = header.indexOf("계획제외");
  const iNo = header.indexOf("No.");

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
  // 파일 자체의 집계 — 수주번호가 비어 있어 MES 수주와 짝지을 수 없는 줄도 포함해 보여주려고 따로 센다
  let fileTotal = 0;
  let fileExcluded = 0;
  let noOrderNo = 0;
  const isExcludedValue = (v: string | number | null): boolean => {
    const t = str(v);
    return t != null && ["Y", "1", "TRUE", "예"].includes(t.toUpperCase());
  };

  db.exec("BEGIN");
  try {
    for (const r of rows.slice(1)) {
      const orderNo = str(r[iOrderNo]);
      // 완전히 빈 줄(No.·수주번호·작업순서 모두 없음)은 파일 건수에서 뺀다
      // (No. 칸이 비고 수주번호도 없는 줄은 합계·여백 줄로 보고 파일 건수에서 뺀다)
      if (!orderNo && (r.every((v) => v == null || String(v).trim() === "") || (iNo !== -1 && str(r[iNo]) == null))) continue;
      fileTotal++;
      if (iExclude !== -1 && isExcludedValue(r[iExclude])) fileExcluded++;
      if (!orderNo) {
        noOrderNo++;
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
      // 계획제외 값은 이 화면이 내려주는 양식에서는 Y/N, 원본(ERP) 수주생산순위지정 파일에서는 0/1이다 — 1(또는 Y)이면 제외로 본다
      const exclude = excludeRaw != null && ["Y", "1", "TRUE", "예"].includes(excludeRaw.toUpperCase()) ? "Y" : "N";

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

  return NextResponse.json({
    updated,
    skippedNotFound,
    skippedInvalid,
    noOrderNo,
    fileTotal,
    fileExcluded,
    fileNotExcluded: fileTotal - fileExcluded,
  });
}
