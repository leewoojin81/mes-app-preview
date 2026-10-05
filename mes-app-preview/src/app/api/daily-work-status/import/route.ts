import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { normalizeWorkDate } from "@/lib/daily-work-status-columns";
import { Readable } from "node:stream";
import ExcelJS from "exceljs";

export const runtime = "nodejs";

function str(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// 엑셀 업로드 임포트(스트리밍 방식 — 한 달치 수십 MB·십만 행 이상 파일도 메모리를 적게 쓰고 서버가 멈추지 않도록 시트를
// 통째로 올리지 않고 한 줄씩 읽는다. 구간(최소~최대 작업일자)을 먼저 구해야 하므로 같은 파일을 두 번 훑는다): 원본 "일일작업현황"(ERP 실적 로그, d_pmmr810) 양식(첫 시트, 1행
// 헤더)을 그대로 읽어 저장한다. 원본 파일이 수십만 행이라 기간을 나눠 여러 번
// 업로드하는 경우가 많은데, record_key upsert만으로는 ERP에서 취소/삭제된 실적이
// DB에 그대로 남기 때문에 "구간 재동기화" 방식을 쓴다(PROD-05와 동일): 업로드 파일의
// 작업일자 최소~최대 구간을 구해 그 구간에 해당하는 기존 데이터를 통째로 지운 뒤,
// 파일 내용 전체를 새로 입력한다(구간 밖 데이터는 유지).

// 셀 값을 원본 시트 읽기(XLSX sheet_to_json)와 같은 모양(문자열·숫자·null)으로 맞춘다
function cellValue(v: unknown): string | number | null {
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace("T", " ");
  const o = v as { richText?: { text: string }[]; result?: unknown; text?: string };
  if (o.richText) return o.richText.map((t) => t.text).join("");
  if (o.result != null) return cellValue(o.result);
  if (typeof o.text === "string") return o.text;
  return null;
}

// 첫 시트를 한 줄씩 내려준다(헤더 줄 포함). 줄 값은 0부터 시작하는 열 순서의 배열이다.
async function* sheetRows(buf: Buffer): AsyncGenerator<(string | number | null)[]> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([buf]), {
    entries: "emit",
    sharedStrings: "cache",
    worksheets: "emit",
    hyperlinks: "ignore",
    styles: "ignore",
  });
  for await (const ws of reader) {
    for await (const row of ws as AsyncIterable<{ values: unknown[] }>) {
      const vals = (row.values as unknown[]).slice(1);
      const out: (string | number | null)[] = [];
      for (let i = 0; i < vals.length; i++) out.push(cellValue(vals[i]));
      yield out;
    }
    return; // 첫 시트만
  }
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "업로드할 파일이 없습니다." }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());

  // 1차: 헤더와 작업일자 구간(최소~최대)만 구한다. work_date는 "YYYY-MM-DD"로 정규화되어 문자열 비교가 날짜 비교와 같다.
  let header: string[] | null = null;
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  let validCount = 0;
  let skipped = 0;
  try {
    for await (const r of sheetRows(buf)) {
      if (!header) {
        header = r.map((h) => (h == null ? "" : String(h).replace(/[▲▼]/g, "").trim()));
        if (header.indexOf("작업일자") === -1) {
          return NextResponse.json({ error: "1행에서 다음 컬럼을 찾을 수 없습니다: 작업일자" }, { status: 400 });
        }
        continue;
      }
      const wd = normalizeWorkDate(r[header.indexOf("작업일자")] ?? null);
      if (!wd) {
        skipped++;
        continue;
      }
      validCount++;
      if (!dateFrom || wd < dateFrom) dateFrom = wd;
      if (!dateTo || wd > dateTo) dateTo = wd;
    }
  } catch {
    return NextResponse.json(
      { error: "엑셀 파일을 읽을 수 없습니다. (.xlsx 파일인지 확인하세요)" },
      { status: 400 }
    );
  }
  if (!header) {
    return NextResponse.json({ error: "엑셀 파일을 읽을 수 없습니다. (.xlsx 파일인지 확인하세요)" }, { status: 400 });
  }
  if (!dateFrom || !dateTo || validCount === 0) {
    return NextResponse.json({ error: "유효한 데이터(작업일자)가 없습니다." }, { status: 400 });
  }

  const idx = (name: string) => header!.indexOf(name);
  const iWorkDate = idx("작업일자");
  const iItemCode = idx("품목코드");
  const iProcessCode = idx("공정코드");
  const iWoNo = idx("작지번호");
  const iLotNo = idx("LOT No");
  const iSeq = idx("공정순서");
  const iRegAt = idx("등록시각");

  const db = getDb();
  // 같은 record_key가 구간 밖 날짜로 남아있는 드문 경우까지 대비해 upsert로 넣는다
  // (정상적으로는 구간을 먼저 지웠으므로 항상 새 INSERT가 일어난다).
  const upsert = db.prepare(
    `INSERT INTO daily_work_status (record_key, work_date, item_code, process_code, wo_no, lot_no, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(record_key) DO UPDATE SET
       work_date = excluded.work_date,
       item_code = excluded.item_code,
       process_code = excluded.process_code,
       wo_no = excluded.wo_no,
       lot_no = excluded.lot_no,
       uploaded_at = datetime('now','localtime'),
       detail = excluded.detail`
  );
  const countInRange = db.prepare(
    "SELECT COUNT(*) AS c FROM daily_work_status WHERE work_date >= ? AND work_date <= ?"
  );
  const deleteInRange = db.prepare(
    "DELETE FROM daily_work_status WHERE work_date >= ? AND work_date <= ?"
  );
  const countAll = db.prepare("SELECT COUNT(*) AS c FROM daily_work_status");

  let deleted = 0;
  let finalTotal = 0;
  let inserted = 0;

  // 2차: 구간의 기존 데이터를 지우고 파일 내용을 한 줄씩 새로 입력한다(한 트랜잭션 — 중간에 실패하면 전부 되돌린다).
  db.exec("BEGIN");
  try {
    deleted = (countInRange.get(dateFrom, dateTo) as { c: number }).c;
    deleteInRange.run(dateFrom, dateTo);
    let first = true;
    for await (const r of sheetRows(buf)) {
      if (first) {
        first = false; // 헤더 줄
        continue;
      }
      const workDate = normalizeWorkDate(r[iWorkDate] ?? null);
      if (!workDate) continue;

      const woNo = iWoNo === -1 ? null : str(r[iWoNo] ?? null);
      const processCode = iProcessCode === -1 ? null : str(r[iProcessCode] ?? null);
      const lotNo = iLotNo === -1 ? null : str(r[iLotNo] ?? null);
      const seq = iSeq === -1 ? null : str(r[iSeq] ?? null);
      const regAt = iRegAt === -1 ? null : str(r[iRegAt] ?? null);
      // 행 하나를 유일하게 식별하는 자연키(작지번호|공정코드|LOT No|공정순서|등록시각).
      // 다섯 값이 전부 비어 있는 행(원본 이상치)은 겹칠 근거가 없으니 임의 키를 준다.
      const naturalKey = [woNo, processCode, lotNo, seq, regAt].join("|");
      const recordKey = naturalKey.replace(/\|/g, "") === "" ? randomUUID() : naturalKey;

      // 원본 시트 전체 컬럼을 헤더명 기준으로 그대로 보존.
      const detail: Record<string, string | number | null> = {};
      header.forEach((name, i) => {
        if (!name) return;
        detail[name] = r[i] == null ? null : r[i];
      });

      upsert.run(
        recordKey,
        workDate,
        iItemCode === -1 ? null : str(r[iItemCode] ?? null),
        processCode,
        woNo,
        lotNo,
        JSON.stringify(detail)
      );
      inserted++;
    }
    finalTotal = (countAll.get() as { c: number }).c;
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({
    dateFrom,
    dateTo,
    deleted,
    inserted,
    skipped,
    finalTotal,
  });
}
