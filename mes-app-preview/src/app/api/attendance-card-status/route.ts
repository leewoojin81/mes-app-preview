import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildAttendanceCardWhere } from "@/lib/attendance-card-filters";

export const runtime = "nodejs";

function parseDetail<T extends { detail?: string | null; edited_fields?: string | null }>(r: T) {
  return {
    ...r,
    detail: r.detail ? JSON.parse(r.detail) : null,
    edited_fields: r.edited_fields ? (JSON.parse(r.edited_fields) as string[]) : null,
  };
}

export async function GET(req: NextRequest) {
  const db = getDb();
  const params = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(params.get("pageSize") ?? "50", 10) || 50));

  const { where, args } = buildAttendanceCardWhere(params);

  const total = (
    db.prepare(`SELECT COUNT(*) as c FROM attendance_card_status ${where}`).get(...args) as {
      c: number;
    }
  ).c;
  const offset = (page - 1) * pageSize;
  const rows = (
    db
      .prepare(
        `SELECT * FROM attendance_card_status ${where} ORDER BY work_date DESC, id DESC LIMIT ? OFFSET ?`
      )
      .all(...args, pageSize, offset) as { detail: string | null; edited_fields: string | null }[]
  ).map(parseDetail);

  const uploadedAt = (
    db.prepare("SELECT MAX(uploaded_at) as t FROM attendance_card_status").get() as {
      t: string | null;
    }
  ).t;

  return NextResponse.json({ rows, total, page, pageSize, uploadedAt });
}
