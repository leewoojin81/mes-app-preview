import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { addDays, ensurePackagingPlanOverrideTable, monthEndOf, weekStartOf } from "@/lib/weekly-report";

export const runtime = "nodejs";

const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;

interface Body {
  yearMonth?: string;
  rows?: { weekStart?: string; planPacks?: number | string | null; planQty?: number | string | null }[];
}

// 주간업무보고 출하공정의 기초계획(월)을 그 달 주차 행별로 직접 수정한다. 팩수·수량이 둘 다 비어 있으면
// 그 주차의 수정값을 지워 자동 계산(계획정보 PLAN-03)으로 되돌린다. 다른 달에는 영향이 없다.
export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  const yearMonth = body?.yearMonth?.trim() ?? "";
  if (!YEAR_MONTH_RE.test(yearMonth) || !Array.isArray(body?.rows)) {
    return NextResponse.json({ error: "yearMonth(YYYY-MM)와 rows가 필요합니다." }, { status: 400 });
  }
  const monthStart = `${yearMonth}-01`;
  const monthEnd = monthEndOf(yearMonth);
  const firstWs = weekStartOf(monthStart);
  const validWeeks = new Set<string>();
  for (let ws = firstWs; ws <= monthEnd; ws = addDays(ws, 7)) validWeeks.add(ws);

  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };
  const parsed: { weekStart: string; packs: number | null; qty: number | null }[] = [];
  for (const r of body.rows) {
    const ws = r.weekStart ?? "";
    if (!validWeeks.has(ws)) return NextResponse.json({ error: `${yearMonth}의 주차가 아닙니다: ${ws}` }, { status: 400 });
    const packs = num(r.planPacks);
    const qty = num(r.planQty);
    if (Number.isNaN(packs) || Number.isNaN(qty) || (packs ?? 0) < 0 || (qty ?? 0) < 0) {
      return NextResponse.json({ error: "팩수·수량은 0 이상의 숫자여야 합니다." }, { status: 400 });
    }
    parsed.push({ weekStart: ws, packs, qty });
  }

  const db = getDb();
  ensurePackagingPlanOverrideTable(db);
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  const user = session?.n || session?.u || "unknown";
  const del = db.prepare("DELETE FROM weekly_packaging_plan_override WHERE year_month = ? AND week_start = ?");
  const up = db.prepare(
    `INSERT INTO weekly_packaging_plan_override (year_month, week_start, plan_packs, plan_qty, updated_by)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(year_month, week_start) DO UPDATE SET plan_packs = excluded.plan_packs,
       plan_qty = excluded.plan_qty, updated_by = excluded.updated_by, updated_at = datetime('now','localtime')`
  );
  db.exec("BEGIN");
  try {
    for (const r of parsed) {
      if (r.packs == null && r.qty == null) del.run(yearMonth, r.weekStart);
      else up.run(yearMonth, r.weekStart, r.packs ?? 0, r.qty ?? 0, user);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return NextResponse.json({ ok: true });
}
