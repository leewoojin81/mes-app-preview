import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { normalizeCardDate } from "@/lib/attendance-card-columns";

export const runtime = "nodejs";

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// 출퇴근카드등록(PSN-02) 행 수정 — 카드 태깅 시스템에서 뽑은 원본 값을 사람이 나중에 고쳐
// 넣을 수 있게 한다(단일행 수정/선택 일괄변경 둘 다 이 엔드포인트를 쓴다 — 일괄변경은
// 선택된 행마다 한 번씩 호출). body.detail은 바뀐 필드만 담은 부분 객체(patch)로 보내면
// 기존 detail에 병합한다. 그중 목록 필터/정렬에 쓰는 몇 개 컬럼(employee_no/work_date/
// org/worker_name/team)은 병합된 detail에서 다시 뽑아 인덱스 컬럼에도 동기화한다.
// 사원번호·근무일자가 바뀌어 다른 행과 자연키(record_key)가 겹치면 409로 막는다.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "잘못된 id입니다." }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body.detail !== "object" || body.detail == null) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const db = getDb();
  const existing = db
    .prepare("SELECT detail FROM attendance_card_status WHERE id = ?")
    .get(id) as { detail: string | null } | undefined;
  if (!existing) {
    return NextResponse.json({ error: "행을 찾을 수 없습니다." }, { status: 404 });
  }

  const currentDetail: Record<string, string | number | null> = existing.detail
    ? JSON.parse(existing.detail)
    : {};
  const patch = body.detail as Record<string, string | number | null>;
  const mergedDetail = { ...currentDetail, ...patch };

  const employeeNo = str(mergedDetail["사원번호"]);
  const workDate = normalizeCardDate(
    mergedDetail["근무일자"] == null ? null : String(mergedDetail["근무일자"])
  );
  if (!employeeNo || !workDate) {
    return NextResponse.json({ error: "사원번호·근무일자는 비울 수 없습니다." }, { status: 400 });
  }
  mergedDetail["근무일자"] = workDate;
  const recordKey = `${employeeNo}|${workDate}`;

  const conflict = db
    .prepare("SELECT id FROM attendance_card_status WHERE record_key = ? AND id != ?")
    .get(recordKey, id) as { id: number } | undefined;
  if (conflict) {
    return NextResponse.json(
      { error: "같은 사원번호·근무일자의 다른 행이 이미 있습니다." },
      { status: 409 }
    );
  }

  db.prepare(
    `UPDATE attendance_card_status SET
       record_key = ?, employee_no = ?, work_date = ?, org = ?, worker_name = ?, team = ?, detail = ?
     WHERE id = ?`
  ).run(
    recordKey,
    employeeNo,
    workDate,
    str(mergedDetail["조직"]),
    str(mergedDetail["이름"]),
    str(mergedDetail["근무조"]),
    JSON.stringify(mergedDetail),
    id
  );

  return NextResponse.json({ ok: true });
}

// 출퇴근카드등록(PSN-02) 행 삭제 — 엑셀 업로드로 잘못 들어온 행 등을 단건으로 지운다.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "잘못된 id입니다." }, { status: 400 });
  }

  const db = getDb();
  const result = db.prepare("DELETE FROM attendance_card_status WHERE id = ?").run(id);
  if (result.changes === 0) {
    return NextResponse.json({ error: "행을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
