import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { DOSU_CHANGE_SUM_KEYS } from "@/lib/dosu-change-columns";
import { buildDosuChangeWhere } from "@/lib/dosu-change-filters";

export const runtime = "nodejs";

function parseDetail<T extends { detail?: string | null }>(r: T) {
  return { ...r, detail: r.detail ? JSON.parse(r.detail) : null };
}

export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(params.get("pageSize") ?? "50", 10) || 50));

  const { where, args } = buildDosuChangeWhere(params);

  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM dosu_change_status ${where}`).get(...args) as {
      c: number;
    }
  ).c;
  const offset = (page - 1) * pageSize;
  const rows = (
    db
      .prepare(
        `SELECT * FROM dosu_change_status ${where} ORDER BY order_date DESC, id DESC LIMIT ? OFFSET ?`
      )
      .all(...args, pageSize, offset) as { detail: string | null }[]
  ).map(parseDetail);

  const uploadedAt = (
    db.prepare("SELECT MAX(uploaded_at) as t FROM dosu_change_status").get() as {
      t: string | null;
    }
  ).t;

  // 하단 합계 행 — 현재 페이지가 아니라 검색/필터 조건이 적용된 전체 건 기준으로 계산한다.
  // 조립 LOT 하나가 투입자재(BASE·착색 등)별로 여러 행으로 나뉘어 있고, 지시/검사/양품/
  // 불량수량은 작업지시번호 단위 값이 각 행에 그대로 복제돼 있다 — 행 그대로 SUM하면
  // 작업지시번호당 행 수만큼(보통 3~4배) 부풀려지므로, 작업지시번호별로 먼저 한 값만
  // 집계(같은 값이라 MAX/MIN 무관)한 뒤 그 결과를 합산한다.
  const perWoSelect = DOSU_CHANGE_SUM_KEYS.map(
    (key) => `MAX(json_extract(detail, '$."${key}"')) as "${key}"`
  ).join(", ");
  const sumSelect = DOSU_CHANGE_SUM_KEYS.map((key) => `SUM("${key}") as "${key}"`).join(", ");
  const totalsRow = db
    .prepare(
      `SELECT ${sumSelect} FROM (SELECT wo_no, ${perWoSelect} FROM dosu_change_status ${where} GROUP BY wo_no)`
    )
    .get(...args) as Record<string, number | null>;
  const totals = Object.fromEntries(DOSU_CHANGE_SUM_KEYS.map((key) => [key, totalsRow[key] ?? 0]));

  return NextResponse.json({ rows, total, page, pageSize, uploadedAt, totals });
}
