import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { numOrNull } from "@/lib/item-fields";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { PRODUCTION_STATUS_LINES } from "@/lib/production-status";
import { ensureProcessUphTargetTable, getProcessUphTarget } from "@/lib/process-uph-target";

export const runtime = "nodejs";

const YEAR_RE = /^\d{4}$/;

export interface ProcessUphTargetRow {
  lineKey: string;
  label: string;
  /** 그 연도에 직접 저장된 값(없으면 null) */
  ownUph: number | null;
  /** 실제 적용되는 값 — 그 연도 값, 없으면 직전 연도 값(없으면 null) */
  effectiveUph: number | null;
  /** effectiveUph가 저장돼 있는 연도 */
  fromYear: number | null;
}

// 기준정보 공정정보(BASE-04) "공정별 목표 UPH" 섹션 — 조회 연도의 라인별 목표를 내려준다.
export async function GET(req: NextRequest) {
  const yearParam = req.nextUrl.searchParams.get("year");
  if (!yearParam || !YEAR_RE.test(yearParam)) {
    return NextResponse.json({ error: "year는 YYYY 형식이어야 합니다." }, { status: 400 });
  }
  const year = Number(yearParam);
  const db = getDb();
  ensureProcessUphTargetTable(db);

  const own = new Map(
    (
      db
        .prepare(`SELECT line_key, target_uph FROM process_uph_target WHERE target_year = ?`)
        .all(year) as { line_key: string; target_uph: number | null }[]
    ).map((r) => [r.line_key, r.target_uph])
  );

  const rows: ProcessUphTargetRow[] = PRODUCTION_STATUS_LINES.map((line) => {
    const eff = getProcessUphTarget(db, line.key, year);
    return {
      lineKey: line.key,
      label: line.label,
      ownUph: own.get(line.key) ?? null,
      effectiveUph: eff?.targetUph ?? null,
      fromYear: eff?.fromYear ?? null,
    };
  });
  return NextResponse.json({ year, rows });
}

// { year, targets: [{ lineKey, targetUph }] } — 그 연도의 목표를 저장한다. targetUph가
// 비어 있으면(null/"") 그 연도 값을 지워 직전 연도 값을 이어받게 한다.
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const year = Number(body?.year);
  if (!body || !Number.isInteger(year) || !YEAR_RE.test(String(year)) || !Array.isArray(body.targets)) {
    return NextResponse.json({ error: "year와 targets가 필요합니다." }, { status: 400 });
  }

  const validKeys = new Set(PRODUCTION_STATUS_LINES.map((l) => l.key));
  const items: { lineKey: string; targetUph: number | null }[] = [];
  for (const t of body.targets) {
    const lineKey = typeof t?.lineKey === "string" ? t.lineKey : "";
    if (!validKeys.has(lineKey)) {
      return NextResponse.json({ error: `알 수 없는 공정입니다: ${lineKey}` }, { status: 400 });
    }
    const n = numOrNull(t?.targetUph);
    if (n === undefined || (n !== null && n <= 0)) {
      return NextResponse.json({ error: "목표 UPH는 0보다 큰 숫자여야 합니다." }, { status: 400 });
    }
    items.push({ lineKey, targetUph: n });
  }

  const db = getDb();
  ensureProcessUphTargetTable(db);
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  const upsert = db.prepare(
    `INSERT INTO process_uph_target (target_year, line_key, target_uph, updated_at, updated_by)
     VALUES (?, ?, ?, datetime('now','localtime'), ?)
     ON CONFLICT(target_year, line_key) DO UPDATE SET
       target_uph = excluded.target_uph, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  );
  db.exec("BEGIN");
  try {
    for (const it of items) upsert.run(year, it.lineKey, it.targetUph, session?.u ?? null);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return NextResponse.json({ ok: true });
}
