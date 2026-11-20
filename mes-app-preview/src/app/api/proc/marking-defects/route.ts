import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { listDefectRows, saveNote, workRowExists } from "@/lib/defect-history";
import { linkPendingMobileDefects } from "@/lib/mobile-defect";

export const runtime = "nodejs";

// 마킹(PROC-06-02) 불량이력관리
//  GET /api/proc/marking-defects?from=&to=&all=1 → 일일작업현황 마킹(P400) 실적 + 불량 내용·사진/동영상 수
//      기본은 불량수량 > 0 이거나 기록이 있는 줄만, all=1이면 전체
//  PUT { key, content } → 불량 내용 저장(빈 값이면 지움)
const PROCESS = "P400";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() + 9 * 3600e3 - 6 * 86400e3).toISOString().slice(0, 10);
  const from = ymd.test(sp.get("from") ?? "") ? sp.get("from")! : weekAgo;
  const to = ymd.test(sp.get("to") ?? "") ? sp.get("to")! : today;
  const db = getDb();
  // 휴대폰(/m/defect)에서 마킹 공정으로 저장한 불량 중 아직 안 붙은 건을 같은 작업지시의 마킹 실적 줄에 붙인다(2026-11-20)
  try {
    linkPendingMobileDefects(db);
  } catch (e) {
    console.error("[모바일 불량입력] PROC-06-02 연결 실패", e);
  }
  const r = listDefectRows(db, { processCode: PROCESS, from, to, onlyBad: sp.get("all") !== "1" });
  const latest = (db.prepare("SELECT MAX(work_date) d FROM daily_work_status WHERE process_code = ?").get(PROCESS) as { d: string | null }).d;
  return NextResponse.json({ from, to, latest, ...r });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { key?: string; content?: string } | null;
  const key = String(body?.key ?? "");
  if (!key) return NextResponse.json({ error: "실적 줄이 없습니다." }, { status: 400 });
  const db = getDb();
  if (!workRowExists(db, key, PROCESS)) return NextResponse.json({ error: "일일작업현황에서 이 실적을 찾을 수 없습니다." }, { status: 404 });
  const user = verifySession(req.cookies.get(COOKIE_NAME)?.value)?.u ?? null;
  saveNote(db, key, String(body?.content ?? "").slice(0, 4000), user);
  return NextResponse.json({ ok: true });
}
