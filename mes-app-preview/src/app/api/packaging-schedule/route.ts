import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import {
  fetchPackagingSchedule,
  PACKAGING_FIELDS,
  PACKAGING_LINES,
  upsertPackagingCell,
  type PackagingField,
} from "@/lib/packaging-schedule";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 62;

// 계획정보(PLAN-03) "출하포장" — 시작일부터 days일 동안의 라인×일자 포장 계획과 실적을 내려준다.
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from");
  const days = Math.min(MAX_DAYS, Math.max(1, parseInt(req.nextUrl.searchParams.get("days") ?? "28", 10) || 28));
  if (!from || !DATE_RE.test(from)) {
    return NextResponse.json({ error: "from은 YYYY-MM-DD 형식이어야 합니다." }, { status: 400 });
  }
  return NextResponse.json(fetchPackagingSchedule(getDb(), from, days));
}

interface PatchBody {
  planDate?: string;
  lineKey?: string;
  fields?: Partial<Record<PackagingField, unknown>>;
}

// 한 칸(라인·일자)의 일부 필드를 저장한다 — 칸마다 blur/엔터 시 바로 저장한다. 모든 필드가 비면 그 칸을 지운다.
export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as PatchBody | null;
  const planDate = body?.planDate?.trim();
  const lineKey = body?.lineKey?.trim();
  if (!planDate || !DATE_RE.test(planDate) || !lineKey || !PACKAGING_LINES.some((l) => l.key === lineKey)) {
    return NextResponse.json({ error: "planDate(YYYY-MM-DD)와 올바른 lineKey가 필요합니다." }, { status: 400 });
  }
  const fields: Partial<Record<PackagingField, unknown>> = {};
  for (const f of PACKAGING_FIELDS) {
    if (body?.fields && Object.prototype.hasOwnProperty.call(body.fields, f)) fields[f] = body.fields[f];
  }
  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "저장할 필드가 없습니다." }, { status: 400 });
  }
  const session = verifySession(req.cookies.get(COOKIE_NAME)?.value);
  upsertPackagingCell(getDb(), planDate, lineKey, fields, session?.u ?? null);
  return NextResponse.json({ ok: true });
}
