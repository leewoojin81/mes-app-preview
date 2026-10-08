import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { PpeItem } from "@/lib/types";
import { nextDueDateAfterIssuance } from "@/lib/ppe";

export const runtime = "nodejs";

// 지급현황 그리드의 "선택 일괄 입력" — 선택한 여러 작업자에게 같은 차수별 지급일을 한 번에 넣는다.
// slots["PPE-01|1"] = "YYYY-MM-DD" 인 차수만 반영(이미 이력이 있으면 지급일 갱신, 없으면 새로 등록)하고,
// 값이 없는 차수는 건드리지 않는다(개별 수정과 달리 빈 값으로 이력을 지우지 않는다).
// remark가 비어 있지 않으면 특이사항도 같은 값으로 덮어쓴다.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (
    !body ||
    !Array.isArray(body.employee_nos) ||
    typeof body.slots !== "object" ||
    body.slots === null
  ) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const employeeNos = Array.from(
    new Set((body.employee_nos as unknown[]).filter((v): v is string => typeof v === "string" && v !== ""))
  );
  if (employeeNos.length === 0) {
    return NextResponse.json({ error: "선택된 작업자가 없습니다." }, { status: 400 });
  }

  const db = getDb();
  const items = new Map(
    (db.prepare("SELECT * FROM ppe_items").all() as unknown as PpeItem[]).map((i) => [i.item_code, i])
  );
  const slots = Object.entries(body.slots as Record<string, unknown>).filter(
    ([, v]) => typeof v === "string" && v !== ""
  ) as [string, string][];
  const remark = typeof body.remark === "string" ? body.remark.trim() : "";
  if (slots.length === 0 && !remark) {
    return NextResponse.json({ error: "입력할 지급일자나 특이사항이 없습니다." }, { status: 400 });
  }
  for (const [key, v] of slots) {
    const [code, seq] = key.split("|");
    if (!items.has(code) || !Number.isInteger(Number(seq)) || Number(seq) < 1) {
      return NextResponse.json({ error: `잘못된 항목입니다: ${key}` }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return NextResponse.json({ error: "지급일자는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
    }
  }

  const exists = db.prepare("SELECT 1 FROM workers WHERE employee_no = ?");
  const upd = db.prepare(
    "UPDATE ppe_issuances SET issue_date = ?, next_due_date = ? WHERE employee_no = ? AND item_code = ? AND issue_seq = ?"
  );
  const ins = db.prepare(
    "INSERT INTO ppe_issuances (employee_no, item_code, issue_date, issue_seq, next_due_date, received_yn) VALUES (?, ?, ?, ?, ?, 'Y')"
  );
  const setRemark = db.prepare("UPDATE workers SET remark = ? WHERE employee_no = ?");

  let workerCount = 0;
  let skipped = 0;
  db.exec("BEGIN");
  try {
    for (const no of employeeNos) {
      if (!exists.get(no)) {
        skipped++;
        continue;
      }
      for (const [key, v] of slots) {
        const [code, seqStr] = key.split("|");
        const seq = Number(seqStr);
        const due = nextDueDateAfterIssuance(items.get(code)!, v);
        if (upd.run(v, due, no, code, seq).changes === 0) ins.run(no, code, v, seq, due);
      }
      if (remark) setRemark.run(remark, no);
      workerCount++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return NextResponse.json({ ok: true, workerCount, skipped });
}
