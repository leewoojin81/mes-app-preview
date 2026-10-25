import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { COOKIE_NAME, verifySession } from "@/lib/auth";
import { listLabelSchedule, saveLabelSchedule } from "@/lib/label-schedule";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 마킹출하공정(PROC-06) 라벨일정 — 수주일자 기간의 MO×대표품목 목록 / 입력칸 저장
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: "수주일자 기간을 입력해 주세요." }, { status: 400 });
  }
  return NextResponse.json({ rows: listLabelSchedule(getDb(), from, to) });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const moNo = typeof body?.mo_no === "string" ? body.mo_no.trim() : "";
  const repItem = typeof body?.rep_item === "string" ? body.rep_item.trim() : "";
  if (!moNo || !repItem) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  for (const k of ["work_date", "prod_date"] as const) {
    const v = body?.[k];
    if (typeof v === "string" && v !== "" && !DATE_RE.test(v)) {
      return NextResponse.json({ error: "날짜 형식이 올바르지 않습니다." }, { status: 400 });
    }
  }
  const user = verifySession(req.cookies.get(COOKIE_NAME)?.value)?.u ?? null;
  saveLabelSchedule(getDb(), moNo, repItem, body as Record<string, string>, user);
  return NextResponse.json({ ok: true });
}
