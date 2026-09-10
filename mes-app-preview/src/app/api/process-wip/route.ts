import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { PROCESS_WIP_SUM_KEYS } from "@/lib/process-wip-columns";

export const runtime = "nodejs";

function parseDetail<T extends { detail?: string | null }>(r: T) {
  return { ...r, detail: r.detail ? JSON.parse(r.detail) : null };
}

export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const searchParam = params.get("search");
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    200,
    Math.max(1, parseInt(params.get("pageSize") ?? "50", 10) || 50)
  );

  const conditions: string[] = [];
  const args: string[] = [];
  if (searchParam) {
    conditions.push(
      "(item_code LIKE ? OR wo_no LIKE ? OR lot_no LIKE ? OR so_no LIKE ? OR json_extract(detail, '$.품목정보') LIKE ?)"
    );
    args.push(
      `%${searchParam}%`,
      `%${searchParam}%`,
      `%${searchParam}%`,
      `%${searchParam}%`,
      `%${searchParam}%`
    );
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM process_wip_status ${where}`).get(...args) as {
      c: number;
    }
  ).c;
  const offset = (page - 1) * pageSize;
  const rows = (
    db
      .prepare(`SELECT * FROM process_wip_status ${where} ORDER BY id LIMIT ? OFFSET ?`)
      .all(...args, pageSize, offset) as { detail: string | null }[]
  ).map(parseDetail);

  const uploadedAt = (
    db.prepare("SELECT MAX(uploaded_at) as t FROM process_wip_status").get() as {
      t: string | null;
    }
  ).t;

  // 하단 합계 행 — 현재 페이지가 아니라 검색 필터가 적용된 전체 건 기준으로 계산한다.
  const sumSelect = PROCESS_WIP_SUM_KEYS.map(
    (key) => `SUM(json_extract(detail, '$."${key}"')) as "${key}"`
  ).join(", ");
  const totalsRow = db
    .prepare(`SELECT ${sumSelect} FROM process_wip_status ${where}`)
    .get(...args) as Record<string, number | null>;
  const totals = Object.fromEntries(
    PROCESS_WIP_SUM_KEYS.map((key) => [key, totalsRow[key] ?? 0])
  );

  return NextResponse.json({ rows, total, page, pageSize, uploadedAt, totals });
}
