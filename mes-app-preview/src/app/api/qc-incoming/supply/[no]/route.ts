import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { cleanLotInput, deleteAddedLot, ensureQcIncomingTables, getSupplyLot, updateSupplyLot } from "@/lib/qc-incoming";
import { CERT_STATUS, PHYS_STATUS, RESULT_OPTIONS } from "@/lib/qc-incoming-shared";

export const runtime = "nodejs";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 부자재 로트 수정 — body.full 이면 수정 창 저장(전체 필드), 아니면 한 칸씩(실물검사/성적서/결과/검사일자)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ no: string }> }) {
  const no = Number((await params).no);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!Number.isInteger(no) || !body) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  const db = getDb();
  ensureQcIncomingTables(db);
  const user = verifySession(req.cookies.get(COOKIE_NAME)?.value)?.u ?? null;
  if (!getSupplyLot(db, no)) return NextResponse.json({ error: "로트를 찾을 수 없습니다." }, { status: 404 });

  if (body.full) {
    const input = cleanLotInput(body);
    if (!input.lot_no) return NextResponse.json({ error: "Lot No.를 입력해 주세요." }, { status: 400 });
    const lot = updateSupplyLot(db, no, input, user);
    return NextResponse.json({ ok: true, lot });
  }

  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (body.phys_status !== undefined) {
    if (!(PHYS_STATUS as readonly string[]).includes(String(body.phys_status))) {
      return NextResponse.json({ error: "실물검사 값이 올바르지 않습니다." }, { status: 400 });
    }
    sets.push("phys_status = ?");
    args.push(String(body.phys_status));
  }
  if (body.cert_status !== undefined) {
    if (!(CERT_STATUS as readonly string[]).includes(String(body.cert_status))) {
      return NextResponse.json({ error: "성적서 값이 올바르지 않습니다." }, { status: 400 });
    }
    const prev = (db.prepare("SELECT cert_status c FROM qc_supply_lots WHERE no = ?").get(no) as { c: string }).c;
    sets.push("cert_status = ?");
    args.push(String(body.cert_status));
    // 성적서를 "작성완료"로 바꾸면 검사일자를 오늘로 맞춘다(대시보드와 같은 규칙)
    if (body.cert_status === "작성완료" && prev !== "작성완료") {
      sets.push("insp_date = ?");
      args.push(today());
    }
  }
  if (body.result !== undefined) {
    const v = String(body.result);
    if (v !== "" && !(RESULT_OPTIONS as readonly string[]).includes(v)) {
      return NextResponse.json({ error: "결과 값이 올바르지 않습니다." }, { status: 400 });
    }
    sets.push("result = ?");
    args.push(v);
  }
  if (body.insp_date !== undefined) {
    const v = String(body.insp_date ?? "");
    if (v !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return NextResponse.json({ error: "검사일자 형식이 올바르지 않습니다." }, { status: 400 });
    }
    // 같은 요청에서 성적서 처리로 이미 정해졌으면 중복 지정하지 않는다
    if (!sets.some((s) => s.startsWith("insp_date"))) {
      sets.push("insp_date = ?");
      args.push(v);
    }
  }
  if (sets.length === 0) return NextResponse.json({ error: "바꿀 항목이 없습니다." }, { status: 400 });
  db.prepare(`UPDATE qc_supply_lots SET ${sets.join(", ")}, updated_at = datetime('now','localtime'), updated_by = ? WHERE no = ?`).run(...args, user, no);
  return NextResponse.json({ ok: true, lot: getSupplyLot(db, no) });
}

// 화면에서 추가한 로트만 삭제할 수 있다(엑셀에서 들어온 로트는 삭제 불가 — 대시보드와 같음)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ no: string }> }) {
  const no = Number((await params).no);
  if (!Number.isInteger(no)) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  const ok = deleteAddedLot(getDb(), no);
  if (!ok) return NextResponse.json({ error: "화면에서 추가한 로트만 삭제할 수 있습니다." }, { status: 400 });
  return NextResponse.json({ ok: true });
}
