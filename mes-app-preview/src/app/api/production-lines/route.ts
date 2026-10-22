import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { numOrNull, strOrNull, strVal } from "@/lib/item-fields";
import { markHistoryActor } from "@/lib/history-actor";
import { ensureProductionLines, getProductionLines } from "@/lib/production-lines";
import { readLineBody } from "./shared";

export const runtime = "nodejs";

// 기준정보 공정정보(BASE-04) "라인 설정" — 생산 라인 목록. 계획(line_capa_plan)·목표 UPH(process_uph_target)에
// 저장된 행 수를 같이 내려 화면이 삭제 가능 여부를 보여준다(저장된 계획이 있는 라인은 삭제 대신 사용중단).
export async function GET() {
  const db = getDb();
  const lines = getProductionLines(db);
  const count = (table: string) =>
    new Map(
      (db.prepare(`SELECT line_key, COUNT(*) c FROM ${table} GROUP BY line_key`).all() as { line_key: string; c: number }[]).map(
        (r) => [r.line_key, r.c]
      )
    );
  let capa = new Map<string, number>();
  let uph = new Map<string, number>();
  try {
    capa = count("line_capa_plan");
    uph = count("process_uph_target");
  } catch {
    // 아직 한 번도 저장하지 않아 테이블이 없는 DB
  }
  return NextResponse.json(
    lines.map((l) => ({ ...l, planCount: (capa.get(l.line_key) ?? 0) + (uph.get(l.line_key) ?? 0) }))
  );
}

// 라인 추가 — line_key는 영문 소문자·숫자·_ 만(계획 테이블에 그대로 저장되는 키라 만든 뒤에는 바꿀 수 없다)
export async function POST(req: NextRequest) {
  const db = getDb();
  ensureProductionLines(db);
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });

  const lineKey = strVal(body.line_key);
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(lineKey)) {
    return NextResponse.json(
      { error: "라인코드는 영문 소문자로 시작하고 영문 소문자·숫자·_ 만 쓸 수 있습니다(2~40자). 예: injection_upper" },
      { status: 400 }
    );
  }
  if (db.prepare("SELECT 1 FROM production_lines WHERE line_key = ?").get(lineKey)) {
    return NextResponse.json({ error: `이미 있는 라인코드입니다: ${lineKey}` }, { status: 409 });
  }
  const parsed = readLineBody(db, body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const seqInput = numOrNull(body.seq);
  if (seqInput === undefined) return NextResponse.json({ error: "순서는 숫자여야 합니다." }, { status: 400 });
  const seq = seqInput ?? ((db.prepare("SELECT MAX(seq) m FROM production_lines").get() as { m: number | null }).m ?? 0) + 10;

  markHistoryActor(db, req);
  db.prepare(
    `INSERT INTO production_lines (line_key, line_name, status_name, result_process_code, is_indirect, seq, use_yn, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(lineKey, parsed.line_name, parsed.status_name, parsed.result_process_code, parsed.is_indirect, seq, parsed.use_yn, strOrNull(body.remark));
  return NextResponse.json({ ok: true, line_key: lineKey }, { status: 201 });
}
