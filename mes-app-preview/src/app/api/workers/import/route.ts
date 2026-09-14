import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { numOrNull, strOrNull, strVal } from "@/lib/item-fields";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

function yn(v: unknown): "Y" | "N" {
  return strVal(v) === "N" ? "N" : "Y";
}

// 엑셀 날짜 serial(1900 date system) 또는 "YYYY-MM-DD"/"YYYY.MM.DD" 문자열을
// "YYYY-MM-DD"로 정규화한다. 값이 없으면 null, 형식을 못 알아보면 원본 문자열 그대로 둔다.
function dateOrNull(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const utcMs = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(utcMs);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return s || null;
}

// 헤더 후보 이름 중 시트에 있는 첫 번째 컬럼 인덱스를 찾는다("엑셀 다운로드"로 받은
// 컬럼명과, 사람이 만든 원본 대장에서 흔히 쓰는 이름을 함께 허용).
function findCol(header: string[], candidates: string[]): number {
  for (const c of candidates) {
    const i = header.indexOf(c);
    if (i !== -1) return i;
  }
  return -1;
}

// 엑셀 업로드: "엑셀 다운로드"가 내려주는 것과 같은 컬럼 구성(사번/성명 필수)을 읽어
// 사번 기준으로 upsert 한다. 이미 있는 사번은 통째로 덮어쓴다. 1행이 제목행이 아니라
// 표 형태가 아래로 몇 행 밀려 있어도(사람이 만든 원본 대장 등) 앞쪽 몇 행에서 "사번"
// 컬럼이 있는 행을 찾아 그 행을 헤더로 쓴다.
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

  let headerRowIdx = -1;
  let header: string[] = [];
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const h = (rows[i] ?? []).map((v) => (v == null ? "" : String(v).trim()));
    if (h.includes("사번")) {
      headerRowIdx = i;
      header = h;
      break;
    }
  }
  if (headerRowIdx === -1) {
    return NextResponse.json(
      { error: "1~10행에서 \"사번\" 컬럼을 찾을 수 없습니다." },
      { status: 400 }
    );
  }

  const iEmployeeNo = header.indexOf("사번");
  const iName = findCol(header, ["성명", "이름"]);
  if (iName === -1) {
    return NextResponse.json({ error: "\"성명\" 컬럼을 찾을 수 없습니다." }, { status: 400 });
  }
  const iSeq = header.indexOf("순번");
  // 비즈 연동 원본값(2026-09-08 사용자 요청) — "비즈이름"은 안 읽는다(성명/도급사 컬럼이
  // 그대로 원본 소스이고, 비즈이름은 그 둘에서 매번 다시 만들어내는 표시용 값이라).
  const iBizEmployeeNo = header.indexOf("비즈사번");
  const iBizDept = header.indexOf("비즈부서");
  const iErpCode = header.indexOf("ERP코드");
  const iEmployeeQr = findCol(header, ["사번QR", "사번 QR"]);
  const iContractor = header.indexOf("도급사");
  const iProcessCode = header.indexOf("공정");
  const iWorkGroup = header.indexOf("소속");
  const iDuty = header.indexOf("직무");
  const iTeam = header.indexOf("조");
  const iPhone = header.indexOf("연락처");
  const iHireDate = header.indexOf("입사일자");
  const iBusRoute = header.indexOf("버스");
  const iBusStop = findCol(header, ["정류장", "탑승지"]);
  const iUniformSize = findCol(header, ["방진복사이즈", "방진복&조끼"]);
  const iShoeSize = findCol(header, ["방진화사이즈", "방진화&안전화"]);
  const iVestSize = header.indexOf("조끼사이즈");
  const iSafetyShoeSize = header.indexOf("안전화사이즈");
  const iStatus = header.indexOf("상태");
  const iResignDate = header.indexOf("퇴사일자");
  const iResignReason = header.indexOf("퇴사사유");
  const iRemark = header.indexOf("특이사항");
  const iUse = header.indexOf("사용여부");

  const db = getDb();
  const existingCodes = new Set(
    (db.prepare("SELECT employee_no FROM workers").all() as { employee_no: string }[]).map(
      (r) => r.employee_no
    )
  );
  const maxSeqRow = db.prepare("SELECT MAX(seq) AS m FROM workers").get() as { m: number | null };
  let nextSeq = (maxSeqRow.m ?? 0) + 10;

  const upsert = db.prepare(
    `INSERT INTO workers
       (employee_no, erp_code, employee_qr, worker_name, contractor, process_code, work_group,
        biz_employee_no, biz_dept, duty, team,
        phone, hire_date, bus_route, bus_stop, uniform_size, shoe_size, vest_size, safety_shoe_size,
        status, resign_date, resign_reason, remark, seq, use_yn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(employee_no) DO UPDATE SET
       erp_code = excluded.erp_code,
       employee_qr = excluded.employee_qr,
       worker_name = excluded.worker_name,
       contractor = excluded.contractor,
       process_code = excluded.process_code,
       work_group = excluded.work_group,
       biz_employee_no = excluded.biz_employee_no,
       biz_dept = excluded.biz_dept,
       duty = excluded.duty,
       team = excluded.team,
       phone = excluded.phone,
       hire_date = excluded.hire_date,
       bus_route = excluded.bus_route,
       bus_stop = excluded.bus_stop,
       uniform_size = excluded.uniform_size,
       shoe_size = excluded.shoe_size,
       vest_size = excluded.vest_size,
       safety_shoe_size = excluded.safety_shoe_size,
       status = excluded.status,
       resign_date = excluded.resign_date,
       resign_reason = excluded.resign_reason,
       remark = excluded.remark,
       seq = excluded.seq,
       use_yn = excluded.use_yn`
  );

  let inserted = 0;
  let updated = 0;
  let skippedNoKey = 0;

  db.exec("BEGIN");
  try {
    for (const r of rows.slice(headerRowIdx + 1)) {
      const employeeNo = strOrNull(r[iEmployeeNo]);
      const workerName = strOrNull(r[iName]);
      if (!employeeNo || !workerName) {
        skippedNoKey++;
        continue;
      }

      const seqNum = iSeq === -1 ? undefined : numOrNull(r[iSeq]);
      const seq = seqNum ? seqNum : nextSeq;
      if (!seqNum) nextSeq += 10;

      upsert.run(
        employeeNo,
        iErpCode === -1 ? null : strOrNull(r[iErpCode]),
        iEmployeeQr === -1 ? null : strOrNull(r[iEmployeeQr]),
        workerName,
        iContractor === -1 ? null : strOrNull(r[iContractor]),
        iProcessCode === -1 ? null : strOrNull(r[iProcessCode]),
        iWorkGroup === -1 ? null : strOrNull(r[iWorkGroup]),
        iBizEmployeeNo === -1 ? null : strOrNull(r[iBizEmployeeNo]),
        iBizDept === -1 ? null : strOrNull(r[iBizDept]),
        iDuty === -1 ? null : strOrNull(r[iDuty]),
        iTeam === -1 ? null : strOrNull(r[iTeam]),
        iPhone === -1 ? null : strOrNull(r[iPhone]),
        iHireDate === -1 ? null : dateOrNull(r[iHireDate]),
        iBusRoute === -1 ? null : strOrNull(r[iBusRoute]),
        iBusStop === -1 ? null : strOrNull(r[iBusStop]),
        iUniformSize === -1 ? null : strOrNull(r[iUniformSize]),
        iShoeSize === -1 ? null : strOrNull(r[iShoeSize]),
        iVestSize === -1 ? null : strOrNull(r[iVestSize]),
        iSafetyShoeSize === -1 ? null : strOrNull(r[iSafetyShoeSize]),
        iStatus === -1 ? null : strOrNull(r[iStatus]),
        iResignDate === -1 ? null : dateOrNull(r[iResignDate]),
        iResignReason === -1 ? null : strOrNull(r[iResignReason]),
        iRemark === -1 ? null : strOrNull(r[iRemark]),
        seq,
        iUse === -1 ? "Y" : yn(r[iUse])
      );
      if (existingCodes.has(employeeNo)) updated++;
      else {
        inserted++;
        existingCodes.add(employeeNo);
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ inserted, updated, skippedNoKey });
}
