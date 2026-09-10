import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { DAILY_WORK_STATUS_SUM_KEYS } from "@/lib/daily-work-status-columns";
import { DAILY_WORK_STATUS_JOIN, buildDailyWorkStatusWhere } from "@/lib/daily-work-status-filters";

export const runtime = "nodejs";

function parseDetail<T extends { detail?: string | null }>(r: T) {
  return { ...r, detail: r.detail ? JSON.parse(r.detail) : null };
}

export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    200,
    Math.max(1, parseInt(params.get("pageSize") ?? "50", 10) || 50)
  );

  const { where, args } = buildDailyWorkStatusWhere(params);

  const total = (
    db
      .prepare(`SELECT COUNT(*) as c ${DAILY_WORK_STATUS_JOIN} ${where}`)
      .get(...args) as { c: number }
  ).c;
  const offset = (page - 1) * pageSize;
  const rows = (
    db
      .prepare(
        `SELECT d.* ${DAILY_WORK_STATUS_JOIN} ${where} ORDER BY d.work_date DESC, d.id DESC LIMIT ? OFFSET ?`
      )
      .all(...args, pageSize, offset) as { detail: string | null }[]
  ).map(parseDetail);

  const uploadedAt = (
    db.prepare("SELECT MAX(uploaded_at) as t FROM daily_work_status").get() as {
      t: string | null;
    }
  ).t;

  // 하단 합계 행 — 현재 페이지가 아니라 검색 필터가 적용된 전체 건 기준으로 계산한다.
  const sumSelect = DAILY_WORK_STATUS_SUM_KEYS.map(
    (key) => `SUM(json_extract(d.detail, '$."${key}"')) as "${key}"`
  ).join(", ");
  const totalsRow = db
    .prepare(`SELECT ${sumSelect} ${DAILY_WORK_STATUS_JOIN} ${where}`)
    .get(...args) as Record<string, number | null>;
  const totals = Object.fromEntries(
    DAILY_WORK_STATUS_SUM_KEYS.map((key) => [key, totalsRow[key] ?? 0])
  );

  return NextResponse.json({ rows, total, page, pageSize, uploadedAt, totals });
}
