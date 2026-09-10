import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { numOrNull, strOrNull, strVal } from "@/lib/item-fields";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";

export const runtime = "nodejs";

// "조장"은 소속공정(복수 가능) 작업자만 조회/등록 가능 — proxy.ts가 페이지/API 접근
// 자체는 이미 걸러주지만, 여기서는 그 안에서 다른 공정 데이터가 보이지 않도록 실제로
// 걸러낸다. 소속공정이 하나도 없는 조장은 아무 작업자도 보이지 않는다.
// 2026-09-04: BASE-04 세부 공정코드(process_code)는 작업자 쪽과 1:1로 안 맞아 이 필터를
// work_group(작업자등록 화면의 "공정", 자유텍스트) 기준으로 바꿨다 — 조장 계정의
// 소속공정도 SYS-01에서 이제 같은 work_group 값 중에서 고른다.
export async function GET(req: NextRequest) {
  const db = getDb();
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  if (session?.r === "leader") {
    const leaderProcessCodes = processCodesFromSession(session);
    if (leaderProcessCodes.length === 0) return NextResponse.json([]);
    const placeholders = leaderProcessCodes.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT * FROM workers WHERE work_group IN (${placeholders}) ORDER BY seq, employee_no`)
      .all(...leaderProcessCodes);
    return NextResponse.json(rows);
  }
  const rows = db.prepare("SELECT * FROM workers ORDER BY seq, employee_no").all();
  return NextResponse.json(rows);
}

// 작업자 등록
export async function POST(req: NextRequest) {
  const db = getDb();
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const employeeNo = strVal(body.employee_no);
  const workerName = strVal(body.worker_name);
  if (!employeeNo) {
    return NextResponse.json({ error: "사번은 필수입니다." }, { status: 400 });
  }
  if (!workerName) {
    return NextResponse.json({ error: "성명은 필수입니다." }, { status: 400 });
  }
  if (db.prepare("SELECT 1 FROM workers WHERE employee_no = ?").get(employeeNo)) {
    return NextResponse.json({ error: `이미 존재하는 사번입니다: ${employeeNo}` }, { status: 409 });
  }

  const erpCode = strOrNull(body.erp_code);
  const employeeQr = strOrNull(body.employee_qr);
  const contractor = strOrNull(body.contractor);
  const processCode = strOrNull(body.process_code);
  // "비즈" 연동 자동입력에서 넘어온 원본값(2026-09-08 사용자 요청) — 비즈 연동 없이
  // 등록하면 둘 다 null로 남는다.
  const bizEmployeeNo = strOrNull(body.biz_employee_no);
  const bizDept = strOrNull(body.biz_dept);
  // 조장은 자기 소속공정(복수 가능) 중 하나로만 등록 가능 — 그 범위를 벗어난 요청은 막는다.
  let workGroup = strOrNull(body.work_group);
  if (session?.r === "leader") {
    const leaderProcessCodes = processCodesFromSession(session);
    if (workGroup && !leaderProcessCodes.includes(workGroup)) {
      return NextResponse.json(
        { error: "소속되지 않은 공정으로는 등록할 수 없습니다." },
        { status: 403 }
      );
    }
    if (!workGroup) {
      if (leaderProcessCodes.length !== 1) {
        return NextResponse.json({ error: "공정을 선택해 주세요." }, { status: 400 });
      }
      workGroup = leaderProcessCodes[0];
    }
  }
  const duty = strOrNull(body.duty);
  const team = strOrNull(body.team);
  const shiftGroup = strOrNull(body.shift_group);
  const phone = strOrNull(body.phone);
  const hireDate = strOrNull(body.hire_date);
  const busRoute = strOrNull(body.bus_route);
  const busStop = strOrNull(body.bus_stop);
  const uniformSize = strOrNull(body.uniform_size);
  const shoeSize = strOrNull(body.shoe_size);
  const status = strOrNull(body.status);
  const resignDate = strOrNull(body.resign_date);
  const resignReason = strOrNull(body.resign_reason);
  const remark = strOrNull(body.remark);
  const useYn = body.use_yn === "N" ? "N" : "Y";

  const seqInput = numOrNull(body.seq);
  let seq: number;
  if (seqInput === undefined) {
    return NextResponse.json({ error: "정렬은 숫자여야 합니다." }, { status: 400 });
  } else if (seqInput === null) {
    const maxSeq = db.prepare("SELECT MAX(seq) AS m FROM workers").get() as { m: number | null };
    seq = (maxSeq.m ?? 0) + 1;
  } else {
    seq = seqInput;
  }

  db.prepare(
    `INSERT INTO workers
       (employee_no, erp_code, employee_qr, worker_name, contractor, process_code, work_group,
        biz_employee_no, biz_dept, duty, team, shift_group,
        phone, hire_date, bus_route, bus_stop, uniform_size, shoe_size, status, resign_date, resign_reason,
        remark, seq, use_yn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    employeeNo,
    erpCode,
    employeeQr,
    workerName,
    contractor,
    processCode,
    workGroup,
    bizEmployeeNo,
    bizDept,
    duty,
    team,
    shiftGroup,
    phone,
    hireDate,
    busRoute,
    busStop,
    uniformSize,
    shoeSize,
    status,
    resignDate,
    resignReason,
    remark,
    seq,
    useYn
  );

  return NextResponse.json({ ok: true, employee_no: employeeNo }, { status: 201 });
}
