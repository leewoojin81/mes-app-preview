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

// 작업자 수정
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ employee_no: string }> }
) {
  const { employee_no: employeeNo } = await params;
  const db = getDb();
  const existing = db
    .prepare("SELECT work_group, team, shift_group, duty, contractor, use_yn FROM workers WHERE employee_no = ?")
    .get(employeeNo) as TrackedSnapshot | undefined;
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

  const workerName = strVal(body.worker_name);
  if (!workerName) {
    return NextResponse.json({ error: "성명은 필수입니다." }, { status: 400 });
  }
  const erpCode = strOrNull(body.erp_code);
  const employeeQr = strOrNull(body.employee_qr);
  const contractor = strOrNull(body.contractor);
  const processCode = strOrNull(body.process_code);
  // 조장은 자기 소속공정(복수 가능) 중 하나로만 옮길 수 있다 — 그 범위를 벗어난 요청은 막는다.
  let workGroup = strOrNull(body.work_group);
  if (leaderProcessCodes) {
    if (workGroup && !leaderProcessCodes.includes(workGroup)) {
      return NextResponse.json(
        { error: "소속되지 않은 공정으로는 옮길 수 없습니다." },
        { status: 403 }
      );
    }
    if (!workGroup) workGroup = existing.work_group;
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

  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE workers SET
         erp_code=?, employee_qr=?, worker_name=?, contractor=?, process_code=?, work_group=?, duty=?, team=?,
         shift_group=?, phone=?, hire_date=?, bus_route=?, bus_stop=?, uniform_size=?, shoe_size=?, status=?,
         resign_date=?, resign_reason=?, remark=?, use_yn=?
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
