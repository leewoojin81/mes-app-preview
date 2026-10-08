import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { PpeItem } from "@/lib/types";
import { nextDueDateAfterIssuance } from "@/lib/ppe";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { ENTITY_TYPE_WORKER, logFieldChanges, WORKER_TRACKED_FIELDS } from "@/lib/master-data-history";

export const runtime = "nodejs";

// 지급현황 그리드의 "수정" — 한 작업자의 차수별 지급일(slots["PPE-01|1"] = "YYYY-MM-DD" | "")과
// 특이사항(workers.remark)을 한 번에 저장한다. 빈 값은 해당 차수 이력 삭제, 값이 있으면
// 있던 이력은 지급일 갱신(다음예정일 재계산), 없으면 새로 등록한다.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ employee_no: string }> }
) {
  const { employee_no: employeeNo } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.slots !== "object" || body.slots === null) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM workers WHERE employee_no = ?").get(employeeNo)) {
    return NextResponse.json({ error: "존재하지 않는 작업자입니다." }, { status: 404 });
  }
  const items = new Map(
    (db.prepare("SELECT * FROM ppe_items").all() as unknown as PpeItem[]).map((i) => [i.item_code, i])
  );
  const slots = body.slots as Record<string, unknown>;
  for (const [key, v] of Object.entries(slots)) {
    const [code, seq] = key.split("|");
    if (!items.has(code) || !Number.isInteger(Number(seq)) || Number(seq) < 1) {
      return NextResponse.json({ error: `잘못된 항목입니다: ${key}` }, { status: 400 });
    }
    if (typeof v !== "string" || (v !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(v))) {
      return NextResponse.json({ error: "지급일자는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
    }
  }

  db.exec("BEGIN");
  try {
    for (const [key, v] of Object.entries(slots) as [string, string][]) {
      const [code, seqStr] = key.split("|");
      const seq = Number(seqStr);
      if (v === "") {
        db.prepare("DELETE FROM ppe_issuances WHERE employee_no = ? AND item_code = ? AND issue_seq = ?").run(
          employeeNo, code, seq
        );
        continue;
      }
      const due = nextDueDateAfterIssuance(items.get(code)!, v);
      const upd = db
        .prepare(
          "UPDATE ppe_issuances SET issue_date = ?, next_due_date = ? WHERE employee_no = ? AND item_code = ? AND issue_seq = ?"
        )
        .run(v, due, employeeNo, code, seq);
      if (upd.changes === 0) {
        db.prepare(
          "INSERT INTO ppe_issuances (employee_no, item_code, issue_date, issue_seq, next_due_date, received_yn) VALUES (?, ?, ?, ?, ?, 'Y')"
        ).run(employeeNo, code, v, seq, due);
      }
    }
    if (typeof body.remark === "string") {
      const before = db.prepare("SELECT remark FROM workers WHERE employee_no = ?").get(employeeNo) as
        | { remark: string | null }
        | undefined;
      const after = body.remark.trim() || null;
      db.prepare("UPDATE workers SET remark = ? WHERE employee_no = ?").run(after, employeeNo);
      // 특이사항 변경은 기준정보 변경이력(BASE-10)에 남긴다
      logFieldChanges(db, {
        entityType: ENTITY_TYPE_WORKER,
        entityId: employeeNo,
        trackedFields: WORKER_TRACKED_FIELDS,
        before: { remark: before?.remark ?? null },
        after: { remark: after },
        changedBy: verifySession(req.cookies.get(COOKIE_NAME)?.value)?.u ?? null,
      });
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return NextResponse.json({ ok: true });
}

// 지급현황 그리드의 "삭제" — 이 작업자의 보호구 지급이력 전체를 지운다(작업자 자체는 유지).
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ employee_no: string }> }
) {
  const { employee_no: employeeNo } = await params;
  const db = getDb();
  db.prepare("DELETE FROM ppe_issuances WHERE employee_no = ?").run(employeeNo);
  return NextResponse.json({ ok: true });
}
