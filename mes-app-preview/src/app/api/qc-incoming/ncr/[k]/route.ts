import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { cleanNcrInput, ensureQcIncomingTables, saveNcr } from "@/lib/qc-incoming";

export const runtime = "nodejs";

// 부적합 처리 기록 저장 — 처리구분·상태·조치일·담당자·원인·조치내용. 모두 비어 있으면(직접 추가한 로트가 아니면) 기록을 지운다.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ k: string }> }) {
  const k = decodeURIComponent((await params).k);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !/^[LBM][\w-]{1,80}$/.test(k)) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  const user = verifySession(req.cookies.get(COOKIE_NAME)?.value)?.u ?? null;
  saveNcr(getDb(), k, cleanNcrInput(body), user);
  return NextResponse.json({ ok: true });
}

// "기록 지우기" — 처리 기록을 지운다(직접 추가한 부적합 로트는 로트 자체가 사라진다 — 대시보드와 같음)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ k: string }> }) {
  const k = decodeURIComponent((await params).k);
  const db = getDb();
  ensureQcIncomingTables(db);
  db.prepare("DELETE FROM qc_ncr WHERE k = ?").run(k);
  return NextResponse.json({ ok: true });
}
