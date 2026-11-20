import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureMobileDefectTables } from "@/lib/mobile-defect";

export const runtime = "nodejs";

// 모바일 불량입력 PC 조회(/mobile-defect-status) — 기간·공정·검색어(작업지시/LOT/품목/입력자)
// ?from=YYYY-MM-DD&to=YYYY-MM-DD&process=마킹&q=PR2026&deleted=1(취소 건 포함)
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const today = new Date().toLocaleDateString("sv-SE");
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const from = ymd.test(sp.get("from") ?? "") ? sp.get("from")! : today;
  const to = ymd.test(sp.get("to") ?? "") ? sp.get("to")! : today;
  const proc = sp.get("process") ?? "";
  const q = (sp.get("q") ?? "").trim();
  const withDeleted = sp.get("deleted") === "1";

  const where = ["date(created_at) BETWEEN ? AND ?"];
  const args: (string | number)[] = [from, to];
  if (!withDeleted) where.push("deleted_at IS NULL");
  if (proc) { where.push("process_name = ?"); args.push(proc); }
  if (q) {
    where.push("(wo_no LIKE ? OR lot_no LIKE ? OR item_code LIKE ? OR item_info LIKE ? OR username LIKE ? OR display_name LIKE ? OR memo LIKE ?)");
    for (let i = 0; i < 7; i++) args.push(`%${q}%`);
  }

  const db = getDb();
  ensureMobileDefectTables(db);
  const rows = db
    .prepare(
      `SELECT id, created_at, wo_no, lot_no, item_code, item_info, process_name, defect_type_code, defect_type_name,
              qty, memo, photo1, photo2, photo3, input_method, username, display_name, deleted_at
       FROM mobile_defect_entries WHERE ${where.join(" AND ")}
       ORDER BY id DESC LIMIT 5000`
    )
    .all(...args);
  return NextResponse.json({ from, to, rows });
}
