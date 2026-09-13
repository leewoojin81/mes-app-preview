import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { numOrNull } from "@/lib/item-fields";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { computeLineCapaPlan, ensureLineCapaPlanTable, PRODUCTION_LINES } from "@/lib/production-plan-lines";

export const runtime = "nodejs";

const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;

// 계획정보(PLAN-02) "공정별 월 CAPA 및 근무계획" — 조회 기준월(yearMonth, "YYYY-MM")의
// 라인별 인원/근무일수/공정별계획/생산성/운영계획/비고를 계산해 내려준다. 인원은
// 작업자등록(BASE-09), 근무일수는 생산캘린더(BASE-08)에서 매번 다시 계산하고, 유일하게
// 시스템에 근거가 없는 "공정별 계획(일CAPA)"만 line_capa_plan에 저장된 값을 읽는다
// (계산 로직은 src/lib/production-plan-lines.ts에 한 곳으로 모아 엑셀 다운로드 라우트와
// 공유한다).
export async function GET(req: NextRequest) {
  const yearMonth = req.nextUrl.searchParams.get("yearMonth");
  if (!yearMonth || !YEAR_MONTH_RE.test(yearMonth)) {
    return NextResponse.json({ error: "yearMonth는 YYYY-MM 형식이어야 합니다." }, { status: 400 });
  }
  const db = getDb();
  return NextResponse.json(computeLineCapaPlan(db, yearMonth));
}

interface CapaBody {
  yearMonth?: string;
  lineKey?: string;
  dailyCapa?: number | string | null;
  remark?: string | null;
}

// 라인 하나의 "공정별 계획(일CAPA)"과 "비고" 칸을 저장한다 — 한 행(year_month, line_key)에
// 두 필드가 같이 들어있지만 화면에서는 입력칸마다 따로 blur 시 저장하므로, 그때 보낸
// 필드가 있는지(hasOwnProperty)만 보고 그 필드만 UPDATE한다(다른 필드는 INSERT 컬럼
// 목록에서 아예 빼서 ON CONFLICT UPDATE가 건드리지 않게 함 — 안 그러면 CAPA 저장이
// 비고를 지우거나 그 반대가 된다). 간접직처럼 CAPA 개념 자체가 없는 라인(isIndirect)은
// dailyCapa만 저장 대상에서 막고, 비고는 모든 라인에서 입력 가능하다.
export async function PATCH(req: NextRequest) {
  const db = getDb();
  const body = (await req.json().catch(() => null)) as CapaBody | null;
  const yearMonth = body?.yearMonth?.trim();
  const lineKey = body?.lineKey?.trim();
  if (!yearMonth || !YEAR_MONTH_RE.test(yearMonth) || !lineKey) {
    return NextResponse.json(
      { error: "yearMonth(YYYY-MM), lineKey가 필요합니다." },
      { status: 400 }
    );
  }
  const line = PRODUCTION_LINES.find((l) => l.key === lineKey);
  if (!line) {
    return NextResponse.json({ error: "존재하지 않는 라인입니다." }, { status: 400 });
  }

  const hasDailyCapa = !!body && Object.prototype.hasOwnProperty.call(body, "dailyCapa");
  const hasRemark = !!body && Object.prototype.hasOwnProperty.call(body, "remark");
  if (!hasDailyCapa && !hasRemark) {
    return NextResponse.json({ error: "dailyCapa 또는 remark 중 하나는 있어야 합니다." }, { status: 400 });
  }

  let dailyCapa: number | null = null;
  if (hasDailyCapa) {
    if (line.isIndirect) {
      return NextResponse.json(
        { error: "간접직은 공정별 계획(CAPA)을 입력할 수 없습니다." },
        { status: 400 }
      );
    }
    const n = numOrNull(body?.dailyCapa);
    if (n === undefined) {
      return NextResponse.json({ error: "공정별 계획은 숫자여야 합니다." }, { status: 400 });
    }
    dailyCapa = n;
  }

  let remark: string | null = null;
  if (hasRemark) {
    const raw = typeof body?.remark === "string" ? body.remark.trim() : body?.remark;
    remark = raw ? String(raw) : null;
  }

  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  ensureLineCapaPlanTable(db);

  if (hasDailyCapa) {
    db.prepare(
      `INSERT INTO line_capa_plan (year_month, line_key, daily_capa, updated_at, updated_by)
       VALUES (?, ?, ?, datetime('now','localtime'), ?)
       ON CONFLICT(year_month, line_key) DO UPDATE SET
         daily_capa = excluded.daily_capa, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    ).run(yearMonth, lineKey, dailyCapa, session?.u ?? null);
  }
  if (hasRemark) {
    db.prepare(
      `INSERT INTO line_capa_plan (year_month, line_key, remark, updated_at, updated_by)
       VALUES (?, ?, ?, datetime('now','localtime'), ?)
       ON CONFLICT(year_month, line_key) DO UPDATE SET
         remark = excluded.remark, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    ).run(yearMonth, lineKey, remark, session?.u ?? null);
  }

  return NextResponse.json({ ok: true });
}
