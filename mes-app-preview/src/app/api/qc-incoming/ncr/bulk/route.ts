import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { ensureQcIncomingTables, isEmptyNcr, type NcrInput } from "@/lib/qc-incoming";
import { NCR_DISPOSITIONS, NCR_STATUS } from "@/lib/qc-incoming-shared";

export const runtime = "nodejs";

// 선택한 부적합 항목들의 상태(필요하면 처리구분·조치일 함께)를 한 번에 바꾼다.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { keys?: unknown; st?: string; disp?: string; adate?: string } | null;
  const keys = Array.isArray(body?.keys) ? body!.keys.map(String).filter((k) => /^[LBM][\w-]{1,80}$/.test(k)) : [];
  if (!body || keys.length === 0) return NextResponse.json({ error: "선택한 항목이 없습니다." }, { status: 400 });
  if (!(NCR_STATUS as readonly string[]).includes(String(body.st))) return NextResponse.json({ error: "상태 값이 올바르지 않습니다." }, { status: 400 });
  const disp = body.disp ? String(body.disp) : "";
  if (disp && !(NCR_DISPOSITIONS as readonly string[]).includes(disp)) return NextResponse.json({ error: "처리구분 값이 올바르지 않습니다." }, { status: 400 });
  const adate = body.adate && /^\d{4}-\d{2}-\d{2}$/.test(body.adate) ? body.adate : "";
  const db = getDb();
  ensureQcIncomingTables(db);
  const user = verifySession(req.cookies.get(COOKIE_NAME)?.value)?.u ?? null;
  db.exec("BEGIN");
  try {
    const get = db.prepare("SELECT manual, disp, st, adate, who, cause, act FROM qc_ncr WHERE k = ?");
    const upsert = db.prepare(
      `INSERT INTO qc_ncr (k, manual, disp, st, adate, who, cause, act, updated_at, updated_by)
       VALUES (?, 0, ?, ?, ?, ?, ?, ?, datetime('now','localtime'), ?)
       ON CONFLICT(k) DO UPDATE SET disp=excluded.disp, st=excluded.st, adate=excluded.adate, who=excluded.who, cause=excluded.cause, act=excluded.act,
         updated_at=excluded.updated_at, updated_by=excluded.updated_by`
    );
    for (const k of keys) {
      const old = get.get(k) as ({ manual: number } & NcrInput) | undefined;
      const rec: NcrInput = {
        disp: disp || old?.disp || "",
        st: body.st!,
        adate: adate || old?.adate || "",
        who: old?.who ?? "",
        cause: old?.cause ?? "",
        act: old?.act ?? "",
      };
      if (isEmptyNcr(old?.manual ?? 0, rec)) db.prepare("DELETE FROM qc_ncr WHERE k = ?").run(k);
      else upsert.run(k, rec.disp, rec.st, rec.adate, rec.who, rec.cause, rec.act, user);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return NextResponse.json({ ok: true, count: keys.length });
}
