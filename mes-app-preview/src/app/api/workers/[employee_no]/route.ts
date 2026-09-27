import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { strOrNull, strVal } from "@/lib/item-fields";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";
import { ENTITY_TYPE_WORKER, logFieldChanges, WORKER_TRACKED_FIELDS } from "@/lib/master-data-history";

export const runtime = "nodejs";

interface TrackedSnapshot {
  [key: string]: string | null;
  work_group: string | null;
  team: string | null;
  shift_group: string | null;
  duty: string | null;
  contractor: string | null;
  use_yn: string | null;
}

// PATCH 본문 중 work_group·process_code를 뺀 나머지 전부 — 조장이 "공정이동"(다른 조장
// 소속으로 이관)만 할 때 이 필드들은 이번 요청 내용과 무관하게 기존 값 그대로 둔다.
interface FullWorkerRow extends TrackedSnapshot {
  erp_code: string | null;
  employee_qr: string | null;
  worker_name: string;
  process_code: string | null;
  phone: string | null;
  hire_date: string | null;
  bus_route: string | null;
  bus_stop: string | null;
  uniform_size: string | null;
  shoe_size: string | null;
  vest_size: string | null;
  safety_shoe_size: string | null;
  status: string | null;
  resign_date: string | null;
  resign_reason: string | null;
  remark: string | null;
}

// 작업자 수정
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ employee_no: string }> }
) {
  const { employee_no: employeeNo } = await params;
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT erp_code, employee_qr, worker_name, contractor, process_code, work_group, duty, team, shift_group,
              phone, hire_date, bus_route, bus_stop, uniform_size, shoe_size, vest_size, safety_shoe_size, status,
              resign_date, resign_reason, remark, use_yn
       FROM workers WHERE employee_no = ?`
    )
    .get(employeeNo) as FullWorkerRow | undefined;
  if (!existing) {
    return NextResponse.json({ error: "작업자를 찾을 수 없습니다." }, { status: 404 });
  }

  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  const leaderProcessCodes = session?.r === "leader" ? processCodesFromSession(session) : null;
  if (leaderProcessCodes && !leaderProcessCodes.includes(existing.work_group ?? "")) {
    return NextResponse.json(
      { error: "다른 공정의 작업자는 수정할 수 없습니다." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  let workerName = strVal(body.worker_name);
  if (!workerName) {
    return NextResponse.json({ error: "성명은 필수입니다." }, { status: 400 });
  }
  let erpCode = strOrNull(body.erp_code);
  let employeeQr = strOrNull(body.employee_qr);
  let contractor = strOrNull(body.contractor);
  let processCode = strOrNull(body.process_code);
  let workGroup = strOrNull(body.work_group);
  if (leaderProcessCodes && !workGroup) workGroup = existing.work_group;
  // 조장이 자기 소속공정 밖으로 공정을 옮기는 요청(신규 입사자 등을 다른 조장에게 이관) —
  // 2026-09-28 사용자 요청으로 이 자체는 허용하되, 그 대신 이번 요청에서는 공정(work_group)·
  // 공정코드만 실제로 반영하고 나머지 필드는 같이 바뀌어 왔어도 무시해 기존 값을 그대로
  // 둔다. 조장이 전출과 동시에 다른 조의 작업자 정보를 함부로 바꾸지 못하게 막는 것 — 그
  // 외 항목은 새로 소속될 조장이 자기 화면에서 다시 고치면 된다.
  const isCrossProcessMove = !!leaderProcessCodes && !!workGroup && !leaderProcessCodes.includes(workGroup);
  let duty = strOrNull(body.duty);
  let team = strOrNull(body.team);
  let shiftGroup = strOrNull(body.shift_group);
  let phone = strOrNull(body.phone);
  let hireDate = strOrNull(body.hire_date);
  let busRoute = strOrNull(body.bus_route);
  let busStop = strOrNull(body.bus_stop);
  let uniformSize = strOrNull(body.uniform_size);
  let shoeSize = strOrNull(body.shoe_size);
  let vestSize = strOrNull(body.vest_size);
  let safetyShoeSize = strOrNull(body.safety_shoe_size);
  let status = strOrNull(body.status);
  let resignDate = strOrNull(body.resign_date);
  let resignReason = strOrNull(body.resign_reason);
  let remark = strOrNull(body.remark);
  let useYn = body.use_yn === "N" ? "N" : "Y";

  if (isCrossProcessMove) {
    workerName = existing.worker_name;
    erpCode = existing.erp_code;
    employeeQr = existing.employee_qr;
    contractor = existing.contractor;
    duty = existing.duty;
    team = existing.team;
    shiftGroup = existing.shift_group;
    phone = existing.phone;
    hireDate = existing.hire_date;
    busRoute = existing.bus_route;
    busStop = existing.bus_stop;
    uniformSize = existing.uniform_size;
    shoeSize = existing.shoe_size;
    vestSize = existing.vest_size;
    safetyShoeSize = existing.safety_shoe_size;
    status = existing.status;
    resignDate = existing.resign_date;
    resignReason = existing.resign_reason;
    remark = existing.remark;
    useYn = existing.use_yn ?? "Y";
    // process_code는 새 공정 소속을 나타내는 값이라 이관 시 그대로 반영한다(비우면 기존
    // 값 유지) — work_group과 같이 바뀌는 게 정상(예: 실링 P380 → 인쇄 P220).
    if (!processCode) processCode = existing.process_code;
  }

  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE workers SET
         erp_code=?, employee_qr=?, worker_name=?, contractor=?, process_code=?, work_group=?, duty=?, team=?,
         shift_group=?, phone=?, hire_date=?, bus_route=?, bus_stop=?, uniform_size=?, shoe_size=?,
         vest_size=?, safety_shoe_size=?, status=?, resign_date=?, resign_reason=?, remark=?, use_yn=?
       WHERE employee_no=?`
    ).run(
      erpCode,
      employeeQr,
      workerName,
      contractor,
      processCode,
      workGroup,
      duty,
      team,
      shiftGroup,
      phone,
      hireDate,
      busRoute,
      busStop,
      uniformSize,
      shoeSize,
      vestSize,
      safetyShoeSize,
      status,
      resignDate,
      resignReason,
      remark,
      useYn,
      employeeNo
    );

    // 기준정보 변경이력(BASE-10) — 추적 대상 6개 필드 중 바뀐 것만 자동 기록.
    logFieldChanges(db, {
      entityType: ENTITY_TYPE_WORKER,
      entityId: employeeNo,
      trackedFields: WORKER_TRACKED_FIELDS,
      before: existing,
      after: { work_group: workGroup, team, shift_group: shiftGroup, duty, contractor, use_yn: useYn },
      changedBy: session?.u ?? null,
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ ok: true });
}

// 작업자 삭제
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ employee_no: string }> }
) {
  const { employee_no: employeeNo } = await params;
  const db = getDb();

  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  if (session?.r === "leader") {
    const leaderProcessCodes = processCodesFromSession(session);
    const existing = db.prepare("SELECT work_group FROM workers WHERE employee_no = ?").get(
      employeeNo
    ) as { work_group: string | null } | undefined;
    if (existing && !leaderProcessCodes.includes(existing.work_group ?? "")) {
      return NextResponse.json(
        { error: "다른 공정의 작업자는 삭제할 수 없습니다." },
        { status: 403 }
      );
    }
  }

  try {
    const result = db.prepare("DELETE FROM workers WHERE employee_no = ?").run(employeeNo);
    if (result.changes === 0) {
      return NextResponse.json({ error: "작업자를 찾을 수 없습니다." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    // 일일근태입력(PSN-01, work_hours_daily) 등에 이 작업자의 기록이 이미 있으면
    // FOREIGN KEY 제약으로 삭제가 막힌다 — 기록을 지우지 않고 안내만 한다.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("FOREIGN KEY")) {
      return NextResponse.json(
        { error: "근태 기록이 있는 작업자는 삭제할 수 없습니다. 사용여부를 '중단'으로 변경해 주세요." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "삭제에 실패했습니다." }, { status: 500 });
  }
}
