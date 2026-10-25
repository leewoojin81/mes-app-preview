import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listShelfLife, setShelfLife } from "@/lib/label-schedule";

export const runtime = "nodejs";

// 라벨일정 형명별 유효기간(년) — 목록 / 저장(years 비우면 삭제)
export async function GET() {
  return NextResponse.json({ items: listShelfLife(getDb()) });
}

export async function PUT(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { model_name?: unknown; years?: unknown } | null;
  const name = typeof body?.model_name === "string" ? body.model_name.trim() : "";
  if (!name) return NextResponse.json({ error: "형명을 입력해 주세요." }, { status: 400 });
  let years: number | null = null;
  if (body?.years !== null && body?.years !== "" && body?.years !== undefined) {
    years = Math.round(Number(body.years));
    if (!Number.isFinite(years) || years <= 0 || years > 20) {
      return NextResponse.json({ error: "유효기간(년)을 1~20 사이로 입력해 주세요." }, { status: 400 });
    }
  }
  setShelfLife(getDb(), name, years);
  return NextResponse.json({ ok: true });
}
