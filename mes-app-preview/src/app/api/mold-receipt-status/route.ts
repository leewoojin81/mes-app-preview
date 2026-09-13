import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { MOLD_RECEIPT_SUM_KEYS } from "@/lib/mold-receipt-columns";
import { buildMoldReceiptWhere } from "@/lib/mold-receipt-filters";

export const runtime = "nodejs";

function parseDetail<T extends { detail?: string | null }>(r: T) {
  return { ...r, detail: r.detail ? JSON.parse(r.detail) : null };
}

export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(params.get("pageSize") ?? "50", 10) || 50));

  const { where, args } = buildMoldReceiptWhere(params);

  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM mold_receipt_status ${where}`).get(...args) as {
      c: number;
    }
  ).c;
  const offset = (page - 1) * pageSize;
  const rows = (
    db
      .prepare(
        `SELECT * FROM mold_receipt_status ${where} ORDER BY receipt_date DESC, id DESC LIMIT ? OFFSET ?`
      )
      .all(...args, pageSize, offset) as { detail: string | null }[]
  ).map(parseDetail);

  const uploadedAt = (
    db.prepare("SELECT MAX(uploaded_at) as t FROM mold_receipt_status").get() as {
      t: string | null;
    }
  ).t;

  // 하단 합계 행 — 현재 페이지가 아니라 검색/필터 조건이 적용된 전체 건 기준으로 계산한다.
  const sumSelect = MOLD_RECEIPT_SUM_KEYS.map(
    (key) => `SUM(json_extract(detail, '$."${key}"')) as "${key}"`
  ).join(", ");
  const totalsRow = db
    .prepare(`SELECT ${sumSelect} FROM mold_receipt_status ${where}`)
    .get(...args) as Record<string, number | null>;
  const totals = Object.fromEntries(
    MOLD_RECEIPT_SUM_KEYS.map((key) => [key, totalsRow[key] ?? 0])
  );

  return NextResponse.json({ rows, total, page, pageSize, uploadedAt, totals });
}
