import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireOperatorForDelete } from "@/lib/operator";
import { numOrNull, strOrNull } from "@/lib/item-fields";
import { markHistoryActor } from "@/lib/history-actor";
import { ensureProductionLines } from "@/lib/production-lines";
import { readLineBody } from "../shared";

export const runtime = "nodejs";

// 라인 수정 — line_key는 바꿀 수 없다(계획·목표 UPH가 이 키로 저장돼 있음)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ line_key: string }> }) {
  const { line_key: lineKey } = await params;
  const db = getDb();
  ensureProductionLines(db);
  if (!db.prepare("SELECT 1 FROM production_lines WHERE line_key = ?").get(lineKey)) {
    return NextResponse.json({ error: "라인을 찾을 수 없습니다." }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  const parsed = readLineBody(db, body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const seq = numOrNull(body.seq);
  if (seq === undefined || seq === null) return NextResponse.json({ error: "순서는 숫자여야 합니다." }, { status: 400 });

  markHistoryActor(db, req);
  db.prepare(
    `UPDATE production_lines SET line_name = ?, status_name = ?, result_process_code = ?, is_indirect = ?, seq = ?, use_yn = ?, remark = ?,
       updated_at = datetime('now','localtime')
     WHERE line_key = ?`
  ).run(parsed.line_name, parsed.status_name, parsed.result_process_code, parsed.is_indirect, seq, parsed.use_yn, strOrNull(body.remark), lineKey);
  return NextResponse.json({ ok: true });
}

// 라인 삭제 — 소속 공정이 있거나 저장된 계획(일CAPA·목표 UPH)이 있으면 막고 사용중단을 안내한다
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ line_key: string }> }) {
  const { line_key: lineKey } = await params;
  const db = getDb();
  const denied = requireOperatorForDelete(req, db);
  if (denied) return denied;
  ensureProductionLines(db);
  const procCount = (db.prepare("SELECT COUNT(*) c FROM processes WHERE line_key = ?").get(lineKey) as { c: number }).c;
  if (procCount > 0) {
    return NextResponse.json({ error: `이 라인에 속한 공정이 ${procCount}개 있습니다. 공정의 라인을 먼저 바꾸세요.` }, { status: 409 });
  }
  let planCount = 0;
  for (const t of ["line_capa_plan", "process_uph_target"]) {
    try {
      planCount += (db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE line_key = ?`).get(lineKey) as { c: number }).c;
    } catch {
      // 테이블이 아직 없는 DB
    }
  }
  if (planCount > 0) {
    return NextResponse.json({ error: "저장된 계획(일CAPA·목표 UPH)이 있는 라인은 삭제할 수 없습니다. 사용여부를 '중단'으로 바꾸세요." }, { status: 409 });
  }
  markHistoryActor(db, req);
  const r = db.prepare("DELETE FROM production_lines WHERE line_key = ?").run(lineKey);
  if (r.changes === 0) return NextResponse.json({ error: "라인을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
