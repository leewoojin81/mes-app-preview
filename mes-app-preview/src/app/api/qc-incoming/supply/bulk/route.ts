import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { ensureQcIncomingTables } from "@/lib/qc-incoming";
import { CERT_STATUS, PHYS_STATUS, RESULT_OPTIONS } from "@/lib/qc-incoming-shared";

export const runtime = "nodejs";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 선택한 로트들의 실물검사/성적서/결과를 한 번에 바꾼다. 성적서를 새로 "작성완료"로 바꾸는 로트는 검사일자도 오늘로 맞춘다.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { nos?: unknown; phys_status?: string; cert_status?: string; result?: string } | null;
  const nos = Array.isArray(body?.nos) ? body!.nos.map((x) => Math.round(Number(x))).filter((x) => Number.isInteger(x) && x > 0) : [];
  if (!body || nos.length === 0) return NextResponse.json({ error: "선택한 로트가 없습니다." }, { status: 400 });
  if (body.phys_status !== undefined && !(PHYS_STATUS as readonly string[]).includes(body.phys_status)) {
    return NextResponse.json({ error: "실물검사 값이 올바르지 않습니다." }, { status: 400 });
  }
  if (body.cert_status !== undefined && !(CERT_STATUS as readonly string[]).includes(body.cert_status)) {
    return NextResponse.json({ error: "성적서 값이 올바르지 않습니다." }, { status: 400 });
  }
  if (body.result !== undefined && body.result !== "" && !(RESULT_OPTIONS as readonly string[]).includes(body.result)) {
    return NextResponse.json({ error: "결과 값이 올바르지 않습니다." }, { status: 400 });
  }
  const db = getDb();
  ensureQcIncomingTables(db);
  const user = verifySession(req.cookies.get(COOKIE_NAME)?.value)?.u ?? null;
  let changed = 0;
  db.exec("BEGIN");
  try {
    const getCur = db.prepare("SELECT cert_status c FROM qc_supply_lots WHERE no = ?");
    for (const no of nos) {
      const cur = getCur.get(no) as { c: string } | undefined;
      if (!cur) continue;
      const sets: string[] = [];
      const args: (string | number | null)[] = [];
      if (body.phys_status !== undefined) {
        sets.push("phys_status = ?");
        args.push(body.phys_status);
      }
      if (body.cert_status !== undefined) {
        sets.push("cert_status = ?");
        args.push(body.cert_status);
        if (body.cert_status === "작성완료" && cur.c !== "작성완료") {
          sets.push("insp_date = ?");
          args.push(today());
        }
      }
      if (body.result !== undefined) {
        sets.push("result = ?");
        args.push(body.result);
      }
      if (sets.length === 0) continue;
      db.prepare(`UPDATE qc_supply_lots SET ${sets.join(", ")}, updated_at = datetime('now','localtime'), updated_by = ? WHERE no = ?`).run(...args, user, no);
      changed++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return NextResponse.json({ ok: true, changed });
}
