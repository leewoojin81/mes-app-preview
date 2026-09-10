import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeCardDate } from "@/lib/attendance-card-columns";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

function str(v: string | number | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// 엑셀 업로드 임포트: 카드 태깅 근태관리 시스템 원본 리포트(첫 시트, 1행 헤더)를 그대로
// 읽어 저장한다. 사원번호+근무일자가 원본에서 항상 유일해(실 파일로 확인) record_key로
// 자연키를 잡는다. 업로드 파일의 근무일자 최소~최대 구간을 구해 그 구간에 해당하는 기존
// 데이터를 통째로 지운 뒤 파일 내용 전체를 새로 입력하는 "구간 재동기화" 방식을 쓴다
// (구매발주등록 PUR-01과 동일한 표준 패턴 — 재업로드 시 원본에서 지워진 행이 DB에 그대로
// 남는 것을 방지).
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
  const idx = (name: string) => header.indexOf(name);

  const iEmployeeNo = idx("사원번호");
  const iWorkDate = idx("근무일자");
  const iOrg = idx("조직");
  const iName = idx("이름");
  const iTeam = idx("근무조");

  const missing = [
    iEmployeeNo === -1 ? "사원번호" : null,
    iWorkDate === -1 ? "근무일자" : null,
  ].filter((v): v is string => v != null);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `1행에서 다음 컬럼을 찾을 수 없습니다: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  type Entry = {
    recordKey: string;
    employeeNo: string;
    workDate: string;
    org: string | null;
    workerName: string | null;
    team: string | null;
    detail: Record<string, string | number | null>;
  };
  const entries: Entry[] = [];
  let skipped = 0;

  for (const r of rows.slice(1)) {
    const employeeNo = str(r[iEmployeeNo]);
    const workDate = normalizeCardDate(r[iWorkDate]);
    if (!employeeNo || !workDate) {
      skipped++;
      continue;
    }

    const recordKey = `${employeeNo}|${workDate}`;

    const detail: Record<string, string | number | null> = {};
    header.forEach((name, i) => {
      if (!name) return;
      detail[name] = r[i] == null ? null : r[i];
    });

    entries.push({
      recordKey,
      employeeNo,
      workDate,
      org: iOrg === -1 ? null : str(r[iOrg]),
      workerName: iName === -1 ? null : str(r[iName]),
      team: iTeam === -1 ? null : str(r[iTeam]),
      detail,
    });
  }

  if (entries.length === 0) {
    return NextResponse.json(
      { error: "유효한 데이터(사원번호·근무일자)가 없습니다." },
      { status: 400 }
    );
  }

  // 업로드 파일의 근무일자 최소~최대 구간 계산 — work_date는 "YYYY-MM-DD"로 정규화되어
  // 있어 문자열 비교로 날짜 비교가 그대로 성립한다.
  let dateFrom = entries[0].workDate;
  let dateTo = entries[0].workDate;
  for (const e of entries) {
    if (e.workDate < dateFrom) dateFrom = e.workDate;
    if (e.workDate > dateTo) dateTo = e.workDate;
  }

  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO attendance_card_status (record_key, employee_no, work_date, org, worker_name, team, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(record_key) DO UPDATE SET
       employee_no = excluded.employee_no,
       work_date = excluded.work_date,
       org = excluded.org,
       worker_name = excluded.worker_name,
       team = excluded.team,
       uploaded_at = datetime('now','localtime'),
       detail = excluded.detail`
  );
  const countInRange = db.prepare(
    "SELECT COUNT(*) AS c FROM attendance_card_status WHERE work_date >= ? AND work_date <= ?"
  );
  const deleteInRange = db.prepare(
    "DELETE FROM attendance_card_status WHERE work_date >= ? AND work_date <= ?"
  );
  const countAll = db.prepare("SELECT COUNT(*) AS c FROM attendance_card_status");

  let deleted = 0;
  let finalTotal = 0;

  db.exec("BEGIN");
  try {
    deleted = (countInRange.get(dateFrom, dateTo) as { c: number }).c;
    deleteInRange.run(dateFrom, dateTo);
    for (const e of entries) {
      upsert.run(
        e.recordKey,
        e.employeeNo,
        e.workDate,
        e.org,
        e.workerName,
        e.team,
        JSON.stringify(e.detail)
      );
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
    inserted: entries.length,
    skipped,
    finalTotal,
  });
}
