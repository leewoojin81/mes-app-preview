import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

// 기준정보 화면 제목 옆 "최근 업로드 / 최종 수정" 표기용. 화면 키 → 수정일자를 볼 테이블.
const SCREEN_TABLE: Record<string, { table: string; uploadKey: string | null }> = {
  items: { table: "items", uploadKey: "items" },
  bom: { table: "bom", uploadKey: "bom" },
  processes: { table: "processes", uploadKey: "processes" },
  equipments: { table: "equipments", uploadKey: null },
  customers: { table: "customers", uploadKey: null },
  warehouses: { table: "warehouses", uploadKey: null },
  workers: { table: "workers", uploadKey: "workers" },
  "production-calendar": { table: "production_calendar", uploadKey: null },
};

export async function GET(req: NextRequest) {
  const screen = req.nextUrl.searchParams.get("screen") ?? "";
  const def = SCREEN_TABLE[screen];
  if (!def) return NextResponse.json({ error: "알 수 없는 화면입니다." }, { status: 400 });

  const db = getDb();
  const updatedAt = (
    db.prepare(`SELECT MAX(updated_at) AS t FROM ${def.table}`).get() as { t: string | null }
  ).t;
  const uploadedAt = def.uploadKey
    ? ((
        db.prepare("SELECT uploaded_at AS t FROM master_upload_log WHERE screen_key = ?").get(def.uploadKey) as
          | { t: string }
          | undefined
      )?.t ?? null)
    : null;
  return NextResponse.json({ uploadedAt, updatedAt });
}
