import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { strOrNull, strVal } from "@/lib/item-fields";
import type { PpeItem } from "@/lib/types";
import { nextDueDateAfterIssuance } from "@/lib/ppe";

export const runtime = "nodejs";

// 특정 작업자의 지급이력(전체 품목) — 지급현황 화면의 "이력" 모달이 쓴다.
export async function GET(req: NextRequest) {
  const employeeNo = req.nextUrl.searchParams.get("employee_no");
  if (!employeeNo) {
    return NextResponse.json({ error: "employee_no는 필수입니다." }, { status: 400 });
  }
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM ppe_issuances WHERE employee_no = ? ORDER BY item_code, issue_seq DESC"
    )
    .all(employeeNo);
  return NextResponse.json(rows);
}

// 지급등록 — 지급차수(issue_seq)와 다음지급예정일(next_due_date)을 서버가 계산해 저장한다.
export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const employeeNo = strVal(body.employee_no);
  const itemCode = strVal(body.item_code);
  const issueDate = strVal(body.issue_date);
  if (!employeeNo) {
    return NextResponse.json({ error: "작업자를 선택해 주세요." }, { status: 400 });
  }
  if (!itemCode) {
    return NextResponse.json({ error: "보호구품목을 선택해 주세요." }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
    return NextResponse.json({ error: "지급일자는 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  }
  if (!db.prepare("SELECT 1 FROM workers WHERE employee_no = ?").get(employeeNo)) {
    return NextResponse.json({ error: "존재하지 않는 작업자입니다." }, { status: 404 });
  }
  const item = db.prepare("SELECT * FROM ppe_items WHERE item_code = ? AND use_yn = 'Y'").get(
    itemCode
  ) as PpeItem | undefined;
  if (!item) {
    return NextResponse.json({ error: "존재하지 않는 보호구품목입니다." }, { status: 404 });
  }

  const receivedYn = body.received_yn === "N" ? "N" : "Y";
  const note = strOrNull(body.note);

  const maxSeqRow = db
    .prepare("SELECT MAX(issue_seq) AS m FROM ppe_issuances WHERE employee_no = ? AND item_code = ?")
    .get(employeeNo, itemCode) as { m: number | null };
  const issueSeq = (maxSeqRow.m ?? 0) + 1;
  const nextDueDate = nextDueDateAfterIssuance(item, issueDate);

  const result = db
    .prepare(
      `INSERT INTO ppe_issuances (employee_no, item_code, issue_date, issue_seq, next_due_date, received_yn, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(employeeNo, itemCode, issueDate, issueSeq, nextDueDate, receivedYn, note);

  return NextResponse.json(
    { ok: true, id: Number(result.lastInsertRowid), issue_seq: issueSeq, next_due_date: nextDueDate },
    { status: 201 }
  );
}
