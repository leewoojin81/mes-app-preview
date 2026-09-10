import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, processCodesFromSession, verifySession } from "@/lib/auth";
import { ENTITY_TYPE_WORKER, logFieldChanges, WORKER_TRACKED_FIELDS } from "@/lib/master-data-history";

export const runtime = "nodejs";

const SHIFT_GROUP_VALUES = ["A조", "B조", "고정"] as const;

// 교대조(작업자등록 BASE-09 workers.shift_group) 전용 부분수정 엔드포인트 — 일일근태입력
// (PSN-01) 그리드에서 개별 선택/선택 일괄변경으로 즉시 반영할 때 쓴다(2026-09-09 사용자
// 요청). /api/workers/[employee_no] PATCH는 전체 필드를 덮어쓰는 방식이라, PSN-01처럼
// 작업자의 일부 필드만 들고 있는 화면에서 그대로 쓰면 remark/방진복사이즈 등 나머지
// 필드가 null로 날아간다 — 그래서 shift_group 하나만 부분수정하는 이 엔드포인트를 따로 둔다.
export async function PATCH(req: NextRequest) {
  const db = getDb();
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.employeeNos)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const employeeNos = (body.employeeNos as unknown[]).filter(
    (v): v is string => typeof v === "string" && v.trim() !== ""
  );
  if (employeeNos.length === 0) {
    return NextResponse.json({ error: "대상 사번이 없습니다." }, { status: 400 });
  }
  const shiftGroup = body.shift_group === null ? null : String(body.shift_group ?? "");
  if (shiftGroup !== null && shiftGroup !== "" && !SHIFT_GROUP_VALUES.includes(shiftGroup as (typeof SHIFT_GROUP_VALUES)[number])) {
    return NextResponse.json({ error: "교대조는 A조/B조/고정 중 하나여야 합니다." }, { status: 400 });
  }
  const value = shiftGroup === "" ? null : shiftGroup;

  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  let targets = employeeNos;
  if (session?.r === "leader") {
    const leaderWorkGroups = processCodesFromSession(session);
    if (leaderWorkGroups.length === 0) {
      targets = [];
    } else {
      const placeholders = leaderWorkGroups.map(() => "?").join(",");
      const allowed = new Set(
        (
          db
            .prepare(`SELECT employee_no FROM workers WHERE work_group IN (${placeholders})`)
            .all(...leaderWorkGroups) as { employee_no: string }[]
        ).map((r) => r.employee_no)
      );
      targets = employeeNos.filter((no) => allowed.has(no));
    }
  }
  if (targets.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  const placeholders = targets.map(() => "?").join(",");
  const changedBy = session?.u ?? null;

  // 대상마다 기존 교대조 값이 서로 다를 수 있어(예: 일부는 A조, 일부는 미지정), 일괄
  // 변경이어도 개인별로 실제 값이 바뀐 사람만 이력에 남긴다 — UPDATE 전에 미리 읽어둔다.
  const beforeRows = db
    .prepare(`SELECT employee_no, shift_group FROM workers WHERE employee_no IN (${placeholders})`)
    .all(...targets) as { employee_no: string; shift_group: string | null }[];
  const beforeByEmployee = new Map(beforeRows.map((r) => [r.employee_no, r.shift_group]));

  db.exec("BEGIN");
  let changes = 0;
  try {
    const result = db
      .prepare(`UPDATE workers SET shift_group = ? WHERE employee_no IN (${placeholders})`)
      .run(value, ...targets);
    changes = Number(result.changes);

    for (const employeeNo of targets) {
      logFieldChanges(db, {
        entityType: ENTITY_TYPE_WORKER,
        entityId: employeeNo,
        trackedFields: WORKER_TRACKED_FIELDS,
        before: { shift_group: beforeByEmployee.get(employeeNo) ?? null },
        after: { shift_group: value },
        changedBy,
      });
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return NextResponse.json({ ok: true, count: changes });
}
